import 'server-only';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client, type _Object } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { readFile } from 'node:fs/promises';
import { one, pool, query } from '../db';
import { phpDate } from '../time';

/**
 * Database backups to DigitalOcean Spaces.
 *
 * pg_dump (custom format, compressed) is streamed straight into a multipart upload, so the
 * server never needs disk space for the dump. Each backup is recorded in wa_backup_runs;
 * backups older than BACKUP_KEEP_DAYS are removed from the bucket (the newest few are always
 * kept). Restore: download the .dump and run
 *   pg_restore --no-owner --no-privileges -d <empty database> wa_next_YYYYMMDD-HHMM.dump
 */

const c = config.backup;
const KEEP_AT_LEAST = 4;
const LOCK = 0x5741_4255; // advisory lock: one backup at a time across processes

export type BackupRun = {
  id: number; trigger: string; status: string; object_key: string | null; size_bytes: number | null; error: string | null;
  created_at: Date; started_at: Date | null; finished_at: Date | null; emp_name: string | null;
};
export type BackupFile = { key: string; name: string; size: number; modified: Date };

/** Env settings still missing ([] when backups can run). */
export function backupMissing(): string[] {
  return ([['DO_SPACES_KEY', c.key], ['DO_SPACES_SECRET', c.secret], ['DO_SPACES_BUCKET', c.bucket], ['DO_SPACES_REGION', c.region]] as const)
    .filter(([, v]) => !v).map(([k]) => k);
}

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    endpoint: c.endpoint || `https://${c.region}.digitaloceanspaces.com`,
    region: 'us-east-1', // Spaces ignores it; the SDK requires one
    credentials: { accessKeyId: c.key, secretAccessKey: c.secret },
    forcePathStyle: true, // https://blr1.digitaloceanspaces.com/<bucket>/<key>
    // S3-compatible services don't all accept the SDK's default CRC32 checksum headers
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

/** pg_dump of DATABASE_URL to stdout (credentials passed via PG* env, not the command line). */
function startDump(): { stdout: Readable; done: Promise<void>; kill: () => void } {
  const url = new URL(config.databaseUrl);
  const env = {
    ...process.env,
    PGHOST: url.hostname || 'localhost',
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username) || process.env.USER || '',
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  const child = spawn('nice', ['-n', '10', c.pgDump, '--format=custom', '--compress=6', '--no-owner', '--no-privileges'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}: ${stderr.trim() || 'no output'}`))));
  });
  return { stdout: child.stdout, done, kill: () => child.kill('SIGTERM') };
}

/** Dump the database into Spaces under `key`; returns the uploaded size. */
async function dumpToSpaces(key: string): Promise<number> {
  const dump = startDump();
  let size = 0;
  dump.stdout.on('data', (b: Buffer) => { size += b.length; });
  const upload = new Upload({
    client: s3(),
    params: { Bucket: c.bucket, Key: key, Body: dump.stdout, ContentType: 'application/octet-stream', ACL: 'private' },
    partSize: 16 * 1024 * 1024,
    queueSize: 2,
  });
  try {
    // A failed dump must not leave a truncated file looking like a backup
    await Promise.all([upload.done(), dump.done]);
  } catch (e) {
    dump.kill();
    await upload.abort().catch(() => undefined);
    await s3().send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: [{ Key: key }] } })).catch(() => undefined);
    throw e;
  }
  return size;
}

const fileName = (key: string) => key.slice(key.lastIndexOf('/') + 1);
const human = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : `${(n / (1 << 20)).toFixed(1)} MB`);

/** Backup files in the bucket, newest first. */
export async function listBackups(): Promise<BackupFile[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, Delimiter: '/', ContinuationToken: token }));
    out.push(...(res.Contents ?? []));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out
    .filter((o) => o.Key && o.Key.endsWith('.dump'))
    .map((o) => ({ key: o.Key!, name: fileName(o.Key!), size: o.Size ?? 0, modified: o.LastModified ?? new Date(0) }))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** Remove backups older than keepDays (always keeping the newest few). Returns how many were removed. */
async function pruneBackups(): Promise<number> {
  const cutoff = Date.now() - c.keepDays * 86400_000;
  const old = (await listBackups()).slice(KEEP_AT_LEAST).filter((f) => f.modified.getTime() < cutoff);
  for (let i = 0; i < old.length; i += 1000) {
    await s3().send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: old.slice(i, i + 1000).map((f) => ({ Key: f.key })) } }));
  }
  return old.length;
}

/** Short-lived download link for one backup (only keys under the backup prefix). */
export async function backupDownloadUrl(key: string): Promise<string | null> {
  if (!key.startsWith(c.prefix) || !key.endsWith('.dump') || key.includes('..')) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: c.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${fileName(key)}"` }), { expiresIn: 900 });
}

/** Run one backup for an existing wa_backup_runs row; never throws (the result is stored on the row). */
async function perform(runId: number, log: (m: string) => void): Promise<void> {
  const key = `${c.prefix}wa_next_${phpDate('Ymd-Hi')}-${runId}.dump`;
  const started = Date.now();
  try {
    const size = await dumpToSpaces(key);
    await query(`UPDATE wa_backup_runs SET status = 'done', object_key = $2, size_bytes = $3, finished_at = now() WHERE id = $1`, [runId, key, size]);
    let pruned = 0;
    try { pruned = await pruneBackups(); } catch (e) { log(`pruning failed: ${(e as Error).message}.`); }
    log(`backup #${runId} ${fileName(key)} ${human(size)} in ${Math.round((Date.now() - started) / 1000)} s${pruned ? `, ${pruned} old backup(s) removed` : ''}.`);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    await query(`UPDATE wa_backup_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [runId, msg.slice(0, 2000)]);
    log(`backup #${runId} FAILED: ${msg}`);
  }
}

/** Hold the backup lock for fn (skipped when another process is backing up). */
async function exclusive(fn: () => Promise<void>, log: (m: string) => void): Promise<void> {
  const conn = await pool.connect();
  try {
    const { rows } = await conn.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK]);
    if (!rows[0].ok) { log('another backup is running.'); return; }
    try {
      // A backup cut off by a worker restart stays "running" forever otherwise
      await query(`UPDATE wa_backup_runs SET status = 'failed', error = 'Interrupted (worker restarted).', finished_at = now()
                    WHERE status = 'running' AND started_at < now() - interval '1 minute'`);
      await fn();
    } finally {
      await conn.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    }
  } finally {
    conn.release();
  }
}

/** wa:db-backup — the scheduled backup (BACKUP_TIMES). */
export async function scheduledBackup(log: (m: string) => void): Promise<void> {
  const missing = backupMissing();
  if (missing.length) { log(`not configured (${missing.join(', ')}); skipped.`); return; }
  await exclusive(async () => {
    const row = await one<{ id: number }>(`INSERT INTO wa_backup_runs (trigger, status, started_at) VALUES ('schedule', 'running', now()) RETURNING id`);
    await perform(row!.id, log);
  }, log);
}

/** wa:db-backup-requested — backups queued from the admin page ("Back up now"). */
export async function requestedBackups(log: (m: string) => void): Promise<void> {
  if (!(await one('SELECT 1 FROM wa_backup_runs WHERE status = $1 LIMIT 1', ['queued']))) return;
  if (backupMissing().length) {
    await query(`UPDATE wa_backup_runs SET status = 'failed', error = 'Backups are not configured.', finished_at = now() WHERE status = 'queued'`);
    return;
  }
  await exclusive(async () => {
    const row = await one<{ id: number }>(
      `UPDATE wa_backup_runs SET status = 'running', started_at = now()
        WHERE id = (SELECT id FROM wa_backup_runs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id`);
    if (row) await perform(row.id, log);
  }, log);
}

export type WalStatus = {
  /** pg_stat_archiver: WAL segments uploaded continuously by PostgreSQL's archive_command (WAL-G). */
  archiving: boolean; archived: number; failed: number; lastArchived: Date | null; lastFailed: Date | null;
  /** Weekly full (base) backups, newest first; null when the status file is not there (e.g. locally). */
  base: { name: string; time: Date; compressed: number; uncompressed: number }[] | null;
};

export async function walStatus(): Promise<WalStatus> {
  const a = await one<{ mode: string; archived_count: number; failed_count: number; last_archived_time: Date | null; last_failed_time: Date | null }>(
    `SELECT current_setting('archive_mode') AS mode, archived_count::int, failed_count::int, last_archived_time, last_failed_time FROM pg_stat_archiver`);
  let base: WalStatus['base'] = null;
  try {
    const list = JSON.parse(await readFile(config.backup.walgStatus, 'utf8')) as { backup_name: string; time: string; compressed_size?: number; uncompressed_size?: number }[];
    base = list.map((b) => ({ name: b.backup_name, time: new Date(b.time), compressed: b.compressed_size ?? 0, uncompressed: b.uncompressed_size ?? 0 }))
      .sort((x, y) => y.time.getTime() - x.time.getTime());
  } catch { /* no status file */ }
  return {
    archiving: a?.mode === 'on', archived: a?.archived_count ?? 0, failed: a?.failed_count ?? 0,
    lastArchived: a?.last_archived_time ?? null, lastFailed: a?.last_failed_time ?? null, base,
  };
}

export function recentRuns(limit = 30): Promise<BackupRun[]> {
  return query<BackupRun>(
    `SELECT r.*, e.emp_name FROM wa_backup_runs r LEFT JOIN js_employee e ON e.emp_id = r.requested_by ORDER BY r.id DESC LIMIT $1`, [limit]);
}

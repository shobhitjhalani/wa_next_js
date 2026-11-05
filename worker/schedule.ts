/**
 * The job schedule (Laravel routes/console.php Schedule::…). Shared by the
 * long-running worker (worker/index.ts) and the cron entry point
 * (`npm run wa -- schedule`, the equivalent of `php artisan schedule:run`).
 *
 * Each job takes a PostgreSQL advisory lock while it runs, so overlapping
 * cron runs / several workers never run the same job twice at the same time
 * (Laravel withoutOverlapping), and its last run is stored in wa_job_runs.
 */
import { createHash } from 'node:crypto';
import { config } from '@/lib/config';
import { pool } from '@/lib/db';
import { cleanup, dispatchCampaigns, emailReports, expireMessages, expirePlans, processWebhooks, sendQueue } from './jobs';

type Schedule = { everySeconds: number } | { hourly: true } | { dailyAt: string };

export interface Job {
  name: string;
  schedule: Schedule;
  run: (log: (m: string) => void) => Promise<unknown>;
}

export const JOBS: Job[] = [
  // Scheduled campaigns whose time has come → queue their messages; then send-queue sends them
  { name: 'dispatch-campaigns', schedule: { everySeconds: 60 }, run: (log) => dispatchCampaigns(log) },
  // Messages older than WA_MSG_EXPIRY (24h) are never sent — cancel them before send-queue looks
  { name: 'expire-messages', schedule: { everySeconds: 300 }, run: (log) => expireMessages(log) },
  { name: 'send-queue', schedule: { everySeconds: 120 }, run: (log) => sendQueue({}, log) },
  { name: 'process-webhooks', schedule: { everySeconds: 60 }, run: (log) => processWebhooks(log) },
  { name: 'expire-plans', schedule: { hourly: true }, run: (log) => expirePlans(log) },
  { name: 'cleanup', schedule: { dailyAt: '02:30' }, run: (log) => cleanup(log) },
  { name: 'email-reports', schedule: { dailyAt: config.reports.time }, run: (log) => emailReports({}, log) },
];

const lockKey = (name: string) => createHash('sha1').update('wa_job:' + name).digest().readInt32BE(0);
const running = new Set<string>();

export const runningJobs = () => running.size;

/** Start of the period the job must have run in (null = not due yet today). */
function periodStart(s: Schedule, at: Date): Date | null {
  if ('hourly' in s) return new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours());
  if ('dailyAt' in s) {
    const [h, m] = s.dailyAt.split(':').map(Number);
    const today = new Date(at.getFullYear(), at.getMonth(), at.getDate(), h, m || 0);
    return at >= today ? today : null;
  }
  return null;
}

export async function isDue(job: Job, at = new Date()): Promise<boolean> {
  const res = await pool.query<{ last_run_at: Date }>('SELECT last_run_at FROM wa_job_runs WHERE job = $1', [job.name]);
  const last = res.rows[0]?.last_run_at ?? null;
  // A few seconds of slack so a cron firing every minute doesn't skip a beat
  if ('everySeconds' in job.schedule) return !last || at.getTime() - last.getTime() >= job.schedule.everySeconds * 1000 - 5000;
  const start = periodStart(job.schedule, at);
  return start !== null && (!last || last < start);
}

/** Run a job if it is still due and no other process is running it. */
export async function runJob(job: Job): Promise<void> {
  if (running.has(job.name)) return;
  running.add(job.name);
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [lockKey(job.name)]);
    if (!rows[0].ok) return;
    try {
      if (!(await isDue(job))) return;
      const started = Date.now();
      const lines: string[] = [];
      await job.run((m) => lines.push(m));
      const result = lines.join(' ');
      await client.query(
        `INSERT INTO wa_job_runs (job, last_run_at, last_result) VALUES ($1, now(), $2)
         ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_result = EXCLUDED.last_result`,
        [job.name, result],
      );
      console.log(`[${new Date().toISOString()}] ${job.name}: ${result} (${Date.now() - started} ms)`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey(job.name)]);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${job.name} failed:`, e);
  } finally {
    client.release();
    running.delete(job.name);
  }
}

/** Run every due job in parallel and wait for them (one cron tick). */
export async function runDueJobs(): Promise<void> {
  const now = new Date();
  await Promise.all(JOBS.map(async (job) => {
    if (running.has(job.name)) return;
    try {
      if (await isDue(job, now)) await runJob(job);
    } catch (e) {
      console.error(job.name, e);
    }
  }));
}

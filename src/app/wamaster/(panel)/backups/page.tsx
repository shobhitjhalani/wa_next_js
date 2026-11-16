import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { backupMissing, listBackups, recentRuns, type BackupFile } from '@/lib/services/backup';
import { numberFormat } from '@/lib/text';
import { backupNow } from './actions';

export const metadata: Metadata = { title: 'Database Backups' };

const size = (n: number | null) => (n == null ? '' : n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : `${numberFormat(n / (1 << 20), 1)} MB`);
const when = (d: Date | null) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' }) : '');
const took = (a: Date | null, b: Date | null) => (a && b ? `${Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000))} s` : '');
const BADGE: Record<string, string> = { done: 'bg-success', failed: 'bg-danger', running: 'bg-info', queued: 'bg-secondary' };

/** Database backups to DigitalOcean Spaces (super admin). */
export default async function BackupsPage() {
  await requireAdminCan('super');
  const missing = backupMissing();
  const b = config.backup;
  const [runs, files] = await Promise.all([
    recentRuns(),
    missing.length ? Promise.resolve({ files: [] as BackupFile[], error: '' })
      : listBackups().then((f) => ({ files: f, error: '' })).catch((e: Error) => ({ files: [] as BackupFile[], error: e.message })),
  ]);
  const busy = runs.some((r) => r.status === 'queued' || r.status === 'running');

  return (
    <>
      <PageTitle title="Database Backups" home="/wamaster/dashboard" />
      {missing.length > 0 && (
        <div className="alert alert-warning">
          Backups are not configured. Add these to the server&apos;s <code>.env</code> and restart the app and worker: <code>{missing.join(', ')}</code>.
        </div>
      )}
      <div className="card">
        <div className="card-body d-flex flex-wrap gap-3 align-items-center">
          <div className="me-auto small">
            <div><span className="text-muted">Schedule:</span> daily at {b.times.join(' and ') || '—'} ({config.timezone})</div>
            <div><span className="text-muted">Kept for:</span> {b.keepDays} days, in Spaces bucket <code>{b.bucket || '—'}</code> ({b.region}) under <code>{b.prefix}</code></div>
          </div>
          <form action={backupNow}>
            <ConfirmButton message="Start a database backup now?" className="btn btn-primary" disabled={!!missing.length || busy}>
              <i className="ri-database-2-line" /> {busy ? 'Backup in progress…' : 'Back up now'}
            </ConfirmButton>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h5 className="card-title mb-0">Backup files</h5></div>
        <div className="card-body">
          {files.error ? <p className="text-danger mb-0">Could not list the bucket: {files.error}</p> : !files.files.length ? (
            <p className="text-muted mb-0">No backups yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle table-striped mb-0">
                <thead className="table-light"><tr><th>#</th><th>File</th><th>Taken</th><th className="text-end">Size</th><th /></tr></thead>
                <tbody>
                  {files.files.map((f, i) => (
                    <tr key={f.key}>
                      <td>{i + 1}</td>
                      <td><code>{f.name}</code></td>
                      <td>{when(f.modified)}</td>
                      <td className="text-end">{size(f.size)}</td>
                      <td className="text-end">
                        <a className="btn btn-sm btn-soft-primary" href={`/wamaster/backups/download?key=${encodeURIComponent(f.key)}`}><i className="ri-download-2-line" /> Download</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="form-text mt-3 mb-0">Restore into an empty database: <code>pg_restore --no-owner --no-privileges -d &lt;database&gt; &lt;file&gt;.dump</code></p>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h5 className="card-title mb-0">Recent runs</h5></div>
        <div className="card-body">
          {!runs.length ? <p className="text-muted mb-0">No backups have run yet.</p> : (
            <div className="table-responsive">
              <table className="table table-sm align-middle table-striped mb-0">
                <thead className="table-light"><tr><th>#</th><th>Started</th><th>Type</th><th>Status</th><th>Duration</th><th className="text-end">Size</th><th>Details</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td className="text-nowrap">{when(r.started_at ?? r.created_at)}</td>
                      <td>{r.trigger === 'manual' ? `Manual${r.emp_name ? ` (${r.emp_name})` : ''}` : 'Scheduled'}</td>
                      <td><span className={`badge ${BADGE[r.status] ?? 'bg-secondary'}`}>{r.status}</span></td>
                      <td>{took(r.started_at, r.finished_at)}</td>
                      <td className="text-end">{size(r.size_bytes)}</td>
                      <td className="small text-break">{r.error ? <span className="text-danger">{r.error}</span> : r.object_key ? <code>{r.object_key.split('/').pop()}</code> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

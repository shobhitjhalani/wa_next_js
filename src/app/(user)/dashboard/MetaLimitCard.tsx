import { metaLimit } from '@/lib/services/meta-limit';
import { numberFormat } from '@/lib/text';

const QUALITY: Record<string, [string, string]> = {
  GREEN: ['success', 'High'],
  YELLOW: ['warning', 'Medium'],
  RED: ['danger', 'Low'],
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-body">
        <p className="text-uppercase fw-medium text-muted mb-2" title="Set by Meta: different people you can message with templates in a rolling 24 hours">
          Meta Daily Limit <i className="ri-information-line" />
        </p>
        {children}
      </div>
    </div>
  );
}

/** Placeholder while Meta is asked. */
export function MetaLimitLoading() {
  return <Shell><div className="placeholder-glow"><span className="placeholder col-6 mb-2" /><span className="placeholder col-12" /></div></Shell>;
}

/** Meta's daily messaging limit of the number and how much of it the last 24 hours used. */
export async function MetaLimitCard({ user }: { user: { u_id: number; u_wa_phone_id?: string | null; u_wa_b_id?: string | null } }) {
  const info = await metaLimit(user).catch(() => null);
  if (!info) return null;
  const known = info.tier !== '';
  const pct = known && info.limit ? Math.min(100, Math.round((info.used / info.limit) * 100)) : 0;
  const bar = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'success';
  const [qColor, qLabel] = QUALITY[info.quality] ?? ['secondary', info.quality ? 'Unknown' : ''];

  return (
    <Shell>
      {!known ? (
        <>
          <h4 className="fs-22 fw-semibold mb-1">{numberFormat(info.used)} <span className="fs-13 text-muted fw-normal">used</span></h4>
          <p className="small text-muted mb-0">{info.error ? `Limit not available: ${info.error}` : 'Meta did not report a limit for this number.'}</p>
        </>
      ) : info.limit === null ? (
        <>
          <h4 className="fs-22 fw-semibold mb-1">Unlimited</h4>
          <p className="small text-muted mb-0">{numberFormat(info.used)} people messaged in the last 24 hours</p>
        </>
      ) : (
        <>
          <h4 className="fs-22 fw-semibold mb-1">
            {numberFormat(info.used)} <span className="fs-15 text-muted fw-normal">/ {numberFormat(info.limit)}</span>
          </h4>
          <div className="progress progress-sm my-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Daily limit used">
            <div className={`progress-bar bg-${bar}`} style={{ width: `${Math.max(pct, info.used ? 2 : 0)}%` }} />
          </div>
          <p className="small text-muted mb-0">
            {numberFormat(Math.max(0, info.limit - info.used))} left · last 24 hours
            {pct >= 100 && <span className="d-block text-danger">Limit reached: new template messages will fail until older ones pass 24 hours.</span>}
          </p>
        </>
      )}
      {qLabel && <p className="small mb-0 mt-2">Quality rating: <span className={`badge bg-${qColor}-subtle text-${qColor}`}>{qLabel}</span></p>}
    </Shell>
  );
}

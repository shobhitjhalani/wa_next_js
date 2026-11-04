import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { like, one, query } from '@/lib/db';
import { campaignGroupIds, campaignIsTracked, campaignSendAt, campaignTitle } from '@/lib/format';
import { sp } from '@/lib/http';
import { campaignStats } from '@/lib/services/campaigns';
import { numberFormat } from '@/lib/text';
import { addDays, now, parseDateRange, phpDate } from '@/lib/time';
import { CAMPAIGN, type CampaignRow, type CampaignStats } from '@/lib/types';
import { DeliveryBar, pct, StatusBadge } from './shared';

type Params = Promise<Record<string, string | string[] | undefined>>;

const PER_PAGE = 20;

/** Campaign dashboard: totals for the period + campaign list with delivery bars (CampaignController::index). */
export default async function CampaignsPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const page = pageParam(params.page);
  // Absent → the last 30 days; present but empty → all time (Laravel input() default semantics)
  const dtInput = params.wa_date === undefined ? `${phpDate('d-m-Y', addDays(now(), -29))} to ${phpDate('d-m-Y')}` : sp(params, 'wa_date');
  const range = parseDateRange(dtInput);
  const q = sp(params, 'q');

  const base: unknown[] = [user.u_id];
  const where = ['uc_user_id = $1'];
  if (range) {
    base.push(phpDate('Y-m-d H:i:s', range[0]), phpDate('Y-m-d H:i:s', range[1]));
    where.push(`uc_created_on >= $${base.length - 1} AND uc_created_on < $${base.length}`);
  }
  if (q !== '') {
    base.push('%' + like(q) + '%');
    where.push(`(uc_name ILIKE $${base.length} OR uc_template ILIKE $${base.length})`);
  }
  const w = where.join(' AND ');

  const [campaigns, counts, tracked] = await Promise.all([
    query<CampaignRow>(`SELECT * FROM js_user_campaign WHERE ${w} ORDER BY uc_id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, base),
    one<{ campaigns: number; scheduled: number }>(
      `SELECT COUNT(*)::int AS campaigns, COUNT(*) FILTER (WHERE uc_status = ${CAMPAIGN.SCHEDULED})::int AS scheduled FROM js_user_campaign WHERE ${w}`, base,
    ),
    // Totals over every tracked campaign in the range, not just this page
    query<CampaignRow>(`SELECT * FROM js_user_campaign WHERE ${w} AND uc_started_at > 0 AND uc_status <> ${CAMPAIGN.SCHEDULED}`, base),
  ]);

  const groupIds = [...new Set(campaigns.flatMap(campaignGroupIds))];
  // Every campaign on this page that has stats is in `tracked`, so one stats pass serves both
  const [stats, groupRows] = await Promise.all([
    campaignStats(tracked),
    groupIds.length
      ? query<{ ug_id: number; up_group_name: string }>('SELECT ug_id, up_group_name FROM js_user_groups WHERE ug_user_id = $1 AND ug_id = ANY($2::int[])', [user.u_id, groupIds])
      : Promise.resolve([]),
  ]);
  const groupNames = new Map(groupRows.map((g) => [g.ug_id, g.up_group_name]));

  const totals = { campaigns: counts?.campaigns ?? 0, scheduled: counts?.scheduled ?? 0, total: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const s of Object.values(stats)) {
    if (!s) continue;
    for (const k of ['total', 'pending', 'sent', 'delivered', 'read', 'failed'] as const) totals[k] += s[k];
  }

  const tiles: [string, string, string, string, string][] = [
    ['Campaigns', numberFormat(totals.campaigns), totals.scheduled ? `${numberFormat(totals.scheduled)} scheduled` : 'in this period', 'ri-megaphone-line', 'primary'],
    ['Messages', numberFormat(totals.total), `${numberFormat(totals.pending)} still queued`, 'ri-mail-send-line', 'info'],
    ['Sent', numberFormat(totals.sent), `${pct(totals.sent, totals.total)} accepted by WhatsApp`, 'ri-check-line', 'secondary'],
    ['Delivered', pct(totals.delivered, totals.sent), `${numberFormat(totals.delivered)} of sent`, 'ri-check-double-line', 'success'],
    ['Read', pct(totals.read, totals.delivered), `${numberFormat(totals.read)} of delivered`, 'ri-eye-line', 'success'],
    ['Failed', numberFormat(totals.failed), `${pct(totals.failed, totals.total)} of messages`, 'ri-error-warning-line', 'danger'],
  ];

  return (
    <>
      <PageTitle title="Campaigns" home="/dashboard" />
      <div className="card">
        <div className="card-body">
          <form method="get" className="row g-2 align-items-center">
            <div className="col-md-4"><DateRangeInput name="wa_date" defaultValue={dtInput} placeholder="Date range" /></div>
            <div className="col-md-4"><input type="search" className="form-control" name="q" defaultValue={q} placeholder="Campaign or template name" aria-label="Search campaigns" /></div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Filter</button></div>
            <div className="col-auto ms-auto"><Link href="/compose" className="btn btn-success"><i className="ri-add-line" /> New Campaign</Link></div>
          </form>
        </div>
      </div>

      <div className="row g-3 mb-3">
        {tiles.map(([label, val, sub, icon, tone]) => (
          <div className="col-6 col-md-4 col-xl-2" key={label}>
            <div className="card stat-tile mb-0">
              <div className="card-body">
                <div className="d-flex align-items-center mb-2">
                  <span className="text-muted small text-uppercase fw-medium me-auto">{label}</span>
                  <i className={`${icon} fs-18 text-${tone}`} aria-hidden="true" />
                </div>
                <div className="stat-value">{val}</div>
                <div className="stat-sub">{sub}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center gap-3">
          <h5 className="card-title mb-0 me-auto">Campaigns</h5>
          <div className="small text-muted d-flex flex-wrap gap-3" aria-label="Legend">
            {[['read', 'Read'], ['delivered', 'Delivered'], ['sent', 'Sent'], ['pending', 'Pending'], ['failed', 'Failed'], ['skipped', 'Skipped']].map(([key, label]) => (
              <span key={key}><span className={`legend-dot seg-${key}`} />{label}</span>
            ))}
          </div>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>Campaign</th>
                  <th>Send Time</th>
                  <th className="text-end">Recipients</th>
                  <th style={{ minWidth: '180px' }}>Delivery</th>
                  <th className="text-end">Delivered</th>
                  <th className="text-end">Read</th>
                  <th className="text-end">Failed</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.length ? campaigns.map((c) => {
                  const s: CampaignStats | null = stats[c.uc_id] ?? null;
                  const ids = campaignGroupIds(c);
                  return (
                    <tr key={c.uc_id}>
                      <td>
                        <Link href={`/campaigns/${c.uc_id}`} className="fw-medium text-body d-inline-block text-truncate" style={{ maxWidth: '260px' }}>{campaignTitle(c)}</Link>
                        <div className="small text-muted text-truncate" style={{ maxWidth: '260px' }}>
                          <i className="ri-file-list-3-line" /> {c.uc_template}
                          {ids.length > 0 && <> · {ids.map((g) => groupNames.get(g)).filter(Boolean).join(', ') || 'deleted group'}</>}
                        </div>
                      </td>
                      <td className="small">{phpDate('d M Y, H:i', campaignSendAt(c))}</td>
                      <td className="text-end">{Number(c.uc_status) === CAMPAIGN.SCHEDULED ? '—' : numberFormat(c.uc_total_contacts)}</td>
                      <td>
                        {s ? <DeliveryBar s={s} /> : (
                          <span className="small text-muted">{campaignIsTracked(c) ? 'Not sent yet' : 'Not tracked (sent before campaign tracking)'}</span>
                        )}
                      </td>
                      <td className="text-end">{s ? pct(s.delivered, s.sent) : '—'}</td>
                      <td className="text-end">{s ? pct(s.read, s.delivered) : '—'}</td>
                      <td className={`text-end ${s && s.failed ? 'text-danger' : ''}`}>{s ? numberFormat(s.failed) : '—'}</td>
                      <td><StatusBadge campaign={c} s={s} /></td>
                      <td className="text-end">
                        <Link href={`/campaigns/${c.uc_id}`} className="btn btn-sm btn-soft-primary">View</Link>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={9} className="text-center text-muted py-5">No campaigns in this period. <Link href="/compose">Create your first campaign</Link>.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Pagination path="/campaigns" params={params} page={page} perPage={PER_PAGE} total={totals.campaigns} /></div>
        </div>
      </div>
    </>
  );
}

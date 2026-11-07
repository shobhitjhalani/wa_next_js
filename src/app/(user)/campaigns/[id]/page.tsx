import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, query, value } from '@/lib/db';
import { campaignGroupIds, campaignIsTracked, campaignSendAt, campaignStatusLabel, campaignTitle } from '@/lib/format';
import { sp } from '@/lib/http';
import { campaignStats } from '@/lib/services/campaigns';
import { limit, numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import type { CampaignRow, MessageRow } from '@/lib/types';
import { barSegments, DeliveryBar, errorText, pct, recipientStatus, recipientWhere, StatusBadge } from '../shared';
import { cancelCampaignAction, resendFailedAction } from './actions';
import { AutoReload } from './AutoReload';

export const metadata: Metadata = { title: 'Campaign' };

type Params = Promise<Record<string, string | string[] | undefined>>;

const PER_PAGE = 50;

const BADGES: Record<string, string> = { Read: 'success', Delivered: 'success', Sent: 'secondary', Pending: 'warning', Failed: 'danger', Skipped: 'light' };
const FILTERS: [string, string][] = [['', 'All'], ['pending', 'Pending'], ['sent', 'Sent'], ['delivered', 'Delivered'], ['read', 'Read'], ['failed', 'Failed'], ['skipped', 'Skipped']];

type Recipient = Pick<MessageRow, 'm_id' | 'm_mobile_no' | 'm_status' | 'm_message_id' | 'm_delivery_status' | 'm_status_response' | 'm_in_process_on' | 'm_updated_on'>;

/** Campaign detail: stats tiles, delivery progress, failure reasons and recipients (CampaignController::show). */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Params }) {
  const user = await requireUser();
  const { id: idParam } = await params;
  if (!/^\d+$/.test(idParam)) notFound();
  const campaign = await one<CampaignRow>('SELECT * FROM js_user_campaign WHERE uc_id = $1 AND uc_user_id = $2', [parseInt(idParam, 10), user.u_id]);
  if (!campaign) notFound();

  const sParams = await searchParams;
  const statusFilter = sp(sParams, 'status');
  const mobileFilter = sp(sParams, 'mobile');
  const page = pageParam(sParams.page);
  const tracked = campaignIsTracked(campaign);
  const groupIds = campaignGroupIds(campaign);

  const rParams: unknown[] = [];
  const rWhere = recipientWhere(campaign.uc_id, statusFilter, mobileFilter, rParams);

  const [statsMap, recipients, recipientTotal, groupNames] = await Promise.all([
    campaignStats([campaign], true),
    tracked
      ? query<Recipient>(
        `SELECT m_id, m_mobile_no, m_status, m_message_id, m_delivery_status, m_status_response, m_in_process_on, m_updated_on
           FROM js_message WHERE ${rWhere} ORDER BY m_id LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, rParams)
      : Promise.resolve(null),
    tracked ? value<number>(`SELECT COUNT(*)::int FROM js_message WHERE ${rWhere}`, rParams) : Promise.resolve(0),
    groupIds.length
      ? query<{ up_group_name: string }>('SELECT up_group_name FROM js_user_groups WHERE ug_user_id = $1 AND ug_id = ANY($2::int[])', [user.u_id, groupIds])
      : Promise.resolve([]),
  ]);
  const stats = statsMap[campaign.uc_id] ?? null;

  const failureReasons = stats && stats.failed
    ? (await query<{ m_status_response: string | null; n: number }>(
      `SELECT m_status_response, COUNT(*)::int AS n FROM js_message
        WHERE m_campaign_id = $1 AND m_status = 3 AND (COALESCE(m_message_id, '') = '' OR m_delivery_status = 'failed')
        GROUP BY m_status_response ORDER BY n DESC LIMIT 5`, [campaign.uc_id],
    )).map((r) => ({ reason: errorText(r.m_status_response), count: r.n }))
    : [];

  const status = campaignStatusLabel(campaign, stats);
  const canCancel = status === 'Scheduled' || (status === 'Sending' && (stats?.pending ?? 0) > 0);
  const canResend = tracked && (status === 'Sending' || status === 'Completed') && (stats?.failed ?? 0) > 0;
  const pastedNumbers = campaign.uc_payload?.numbers?.length ?? 0;

  const again = new URLSearchParams();
  if (campaign.uc_template_id) again.set('tm', String(campaign.uc_template_id));
  for (const g of groupIds) again.append('group', String(g));
  const againQs = again.toString();

  const filterHref = (key: string) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sParams)) {
      if (k === 'status' || k === 'page' || v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
    }
    if (key) qs.set('status', key);
    const s = qs.toString();
    return `/campaigns/${campaign.uc_id}${s ? '?' + s : ''}`;
  };

  return (
    <>
      <PageTitle title="Campaign" home="/dashboard" />
      {(status === 'Sending' || status === 'Scheduled') && <AutoReload />}

      <div className="card">
        <div className="card-body d-flex flex-wrap gap-3 align-items-start">
          <div className="me-auto">
            <div className="d-flex align-items-center gap-2 mb-1">
              <h4 className="mb-0">{campaignTitle(campaign)}</h4>
              <StatusBadge campaign={campaign} s={stats} />
            </div>
            <div className="text-muted small d-flex flex-wrap gap-3">
              <span><i className="ri-file-list-3-line" /> {campaign.uc_template}</span>
              <span><i className="ri-calendar-line" />{' '}
                {status === 'Scheduled' ? `Scheduled for ${phpDate('d M Y, H:i', campaign.uc_scheduled_at)}` : `Sent ${phpDate('d M Y, H:i', campaignSendAt(campaign))}`}
              </span>
              {groupNames.length > 0 && <span><i className="ri-group-line" /> {groupNames.map((g) => g.up_group_name).join(', ')}</span>}
              {pastedNumbers > 0 && <span><i className="ri-phone-line" /> {numberFormat(pastedNumbers)} pasted number(s)</span>}
              {Number(campaign.uc_resent_at) > 0 && <span><i className="ri-restart-line" /> Failed messages resent {phpDate('d M Y, H:i', Number(campaign.uc_resent_at))}</span>}
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            {tracked && status !== 'Scheduled' && (
              <a href={`/campaigns/${campaign.uc_id}/export`} className="btn btn-soft-info"><i className="ri-download-2-line" /> Export</a>
            )}
            <Link href={`/compose${againQs ? '?' + againQs : ''}`} className="btn btn-soft-primary"><i className="ri-repeat-line" /> Send Again</Link>
            {canResend && (
              <form action={resendFailedAction.bind(null, campaign.uc_id)}>
                <ConfirmButton
                  message={`Send the ${numberFormat(stats?.failed ?? 0)} failed message(s) again? They are queued as new messages and count towards your template messages.`}
                  className="btn btn-soft-warning"
                >
                  <i className="ri-restart-line" /> Resend Failed ({numberFormat(stats?.failed ?? 0)})
                </ConfirmButton>
              </form>
            )}
            {canCancel && (
              <form action={cancelCampaignAction.bind(null, campaign.uc_id)}>
                <ConfirmButton message={status === 'Scheduled' ? 'Cancel this scheduled campaign?' : 'Cancel the messages that have not been sent yet?'} className="btn btn-soft-danger">
                  <i className="ri-close-circle-line" /> {status === 'Scheduled' ? 'Cancel Campaign' : 'Stop Sending'}
                </ConfirmButton>
              </form>
            )}
          </div>
        </div>
      </div>

      {!tracked ? (
        <div className="alert alert-light border">This campaign was sent before per-message tracking was added, so only its recipient count ({numberFormat(campaign.uc_total_contacts)}) is known. Use <Link href="/reports">Reports</Link> for its messages and delivery status.</div>
      ) : status === 'Scheduled' ? (
        <div className="alert alert-info">Messages are created when the campaign starts, from the groups&apos; members at that moment. Opted-out contacts are skipped.</div>
      ) : stats ? (
        <>
          <div className="row g-3 mb-3">
            {([
              ['Recipients', numberFormat(stats.total), stats.skipped ? `${numberFormat(stats.skipped)} skipped (opted out / cancelled)` : 'messages queued'],
              ['Sent', numberFormat(stats.sent), `${pct(stats.sent, stats.total)} accepted by WhatsApp`],
              ['Delivered', pct(stats.delivered, stats.sent), `${numberFormat(stats.delivered)} of sent`],
              ['Read', pct(stats.read, stats.delivered), `${numberFormat(stats.read)} of delivered`],
              ['Replied', pct(stats.replied ?? 0, stats.sent), `${numberFormat(stats.replied ?? 0)} wrote back within 3 days`],
              ['Failed', numberFormat(stats.failed), `${pct(stats.failed, stats.total)} of messages`],
            ] as [string, string, string][]).map(([label, val, sub]) => (
              <div className="col-6 col-md-4 col-xl-2" key={label}>
                <div className="card stat-tile mb-0"><div className="card-body">
                  <div className="text-muted small text-uppercase fw-medium mb-2">{label}</div>
                  <div className="stat-value">{val}</div>
                  <div className="stat-sub">{sub}</div>
                </div></div>
              </div>
            ))}
          </div>

          <div className="row g-3">
            <div className={failureReasons.length ? 'col-xl-8' : 'col-12'}>
              <div className="card">
                <div className="card-header"><h5 className="card-title mb-0">Delivery Progress</h5></div>
                <div className="card-body">
                  <DeliveryBar s={stats} large />
                  <div className="small text-muted d-flex flex-wrap gap-3 mt-3">
                    {barSegments(stats).map(([key, label, n]) => (
                      <span key={key}><span className={`legend-dot seg-${key}`} />{label} <strong className="text-body">{numberFormat(n)}</strong></span>
                    ))}
                  </div>
                  {stats.pending > 0 && (
                    <p className="small text-muted mt-3 mb-0"><i className="ri-loader-4-line" /> {numberFormat(stats.pending)} message(s) still queued. This page refreshes every 30 seconds.</p>
                  )}
                </div>
              </div>
            </div>
            {failureReasons.length > 0 && (
              <div className="col-xl-4">
                <div className="card">
                  <div className="card-header"><h5 className="card-title mb-0">Top Failure Reasons</h5></div>
                  <div className="card-body">
                    <ul className="list-unstyled mb-0">
                      {failureReasons.map((r, i) => (
                        <li className="d-flex gap-2 mb-2" key={i}>
                          <span className="small me-auto">{limit(r.reason, 120)}</span>
                          <span className="fw-semibold small">{numberFormat(r.count)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}

      {recipients && (
        <div className="card">
          <div className="card-header">
            <form method="get" className="d-flex flex-wrap gap-2 align-items-center">
              <h5 className="card-title mb-0 me-auto">Recipients</h5>
              <div className="btn-group btn-group-sm flex-wrap" role="group" aria-label="Filter by status">
                {FILTERS.map(([key, label]) => (
                  <Link key={key || 'all'} href={filterHref(key)} className={`btn btn-outline-secondary ${statusFilter === key ? 'active' : ''}`}>{label}</Link>
                ))}
              </div>
              <input type="hidden" name="status" value={statusFilter} />
              <input type="search" className="form-control form-control-sm" name="mobile" defaultValue={mobileFilter} placeholder="Mobile number" aria-label="Search mobile number" style={{ maxWidth: '180px' }} />
            </form>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-sm align-middle table-nowrap mb-0">
                <thead className="table-light"><tr><th>Mobile</th><th>Status</th><th>Sent At</th><th>Last Update</th><th>Error</th></tr></thead>
                <tbody>
                  {recipients.length ? recipients.map((m) => {
                    const state = recipientStatus(m);
                    const badge = BADGES[state];
                    return (
                      <tr key={m.m_id}>
                        <td><Link href={`/chat?mb=${encodeURIComponent(m.m_mobile_no ?? '')}`} className="text-body" title="Open in Inbox">{m.m_mobile_no}</Link></td>
                        <td><span className={`badge bg-${badge}-subtle text-${badge === 'light' ? 'body' : badge}`}>{state}</span></td>
                        <td className="small">{m.m_in_process_on ? phpDate('d M, H:i', Number(m.m_in_process_on)) : '—'}</td>
                        <td className="small">{m.m_updated_on ? phpDate('d M, H:i', Number(m.m_updated_on)) : '—'}</td>
                        <td className="small text-danger msg-content">{state === 'Failed' ? limit(errorText(m.m_status_response), 90) : ''}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={5} className="text-center text-muted py-4">No recipients match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3"><Pagination path={`/campaigns/${campaign.uc_id}`} params={sParams} page={page} perPage={PER_PAGE} total={recipientTotal ?? 0} /></div>
          </div>
        </div>
      )}
    </>
  );
}

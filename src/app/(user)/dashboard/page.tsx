import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { StatusMatrix } from '@/components/StatusMatrix';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { buildMatrix, TEMPLATE_TYPES } from '@/lib/services/reports';
import { numberFormat } from '@/lib/text';
import { addDays, dayStart, parseDateRange, phpDate, todayString } from '@/lib/time';
import { WhatsAppSignup } from './WhatsAppSignup';

export const metadata: Metadata = { title: 'Dashboard' };

type Params = Promise<Record<string, string | string[] | undefined>>;

/** User dashboard (User\DashboardController::index). */
export default async function DashboardPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const dtSearch = params.dt_search === undefined ? todayString() : sp(params, 'dt_search');
  const today = dayStart();
  const [from, to] = parseDateRange(dtSearch) ?? [today, addDays(today, 1)];
  const queFrom = today - config.queTime;
  const msgLimit = Number(user.u_msg_limit ?? 0);

  // Laravel whereBetween is inclusive of both bounds
  const [sentRows, queRows, incoming, sentTotal] = await Promise.all([
    // Sent + API errors in the range, one pass over the (m_user_id, m_in_process_on) partial index
    query<{ name: string | null; col: string; tpl: boolean | null; n: number }>(
      `SELECT m_msg_template_name AS name,
              CASE WHEN m_message_id <> '' THEN COALESCE(NULLIF(NULLIF(m_delivery_status, ''), '0'), 'sent') ELSE '#Error' END AS col,
              m_msg_type = ANY($4::text[]) AS tpl,
              COUNT(*)::int AS n
         FROM js_message
        WHERE m_user_id = $1 AND m_is_incoming = 2 AND m_status = 3 AND m_dstatus = 0
          AND m_in_process_on BETWEEN $2 AND $3 AND m_message_id IS NOT NULL
        GROUP BY 1, 2, 3`,
      [user.u_id, from, to, TEMPLATE_TYPES],
    ),
    // Live queue (status 1 = In Que, 6 = Processing) by template
    query<{ name: string | null; n: number; queued: number }>(
      `SELECT m_msg_template_name AS name, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE m_status = 1)::int AS queued
         FROM js_message
        WHERE m_user_id = $1 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_status IN (1, 6) AND m_created_on >= $2
        GROUP BY 1`,
      [user.u_id, queFrom],
    ),
    value<number>(
      `SELECT COUNT(*)::int FROM js_message
        WHERE m_user_id = $1 AND m_is_incoming = 1 AND m_dstatus = 0 AND m_created_on BETWEEN $2 AND $3`,
      [user.u_id, from, to],
    ),
    // All-time count is only needed (and only paid for) when the account has a message cap
    msgLimit > 0
      ? value<number>(
        `SELECT COUNT(*)::int FROM js_message
          WHERE m_user_id = $1 AND m_is_incoming = 2 AND m_status = 3 AND m_dstatus = 0 AND m_message_id <> ''
            AND m_msg_type = ANY($2::text[])
            AND (m_delivery_status IS NULL OR m_delivery_status NOT IN ('failed', 'error'))`,
        [user.u_id, TEMPLATE_TYPES],
      )
      : Promise.resolve(null),
  ]);

  let sentInRange = 0;
  let inQueue = 0;
  const data = new Map<string, Record<string, number>>();
  const add = (name: string | null, col: string, n: number) => {
    const key = name || '-';
    const row = data.get(key) ?? {};
    row[col] = (row[col] ?? 0) + n;
    data.set(key, row);
  };
  for (const r of sentRows) {
    if (r.col === '#Error') add(r.name, 'Error', r.n);
    else {
      sentInRange += r.n;
      if (r.tpl) add(r.name, r.col, r.n);
    }
  }
  for (const r of queRows) {
    inQueue += r.queued;
    add(r.name, 'Que', r.n);
  }
  const templateReport = buildMatrix(data, ['Que', 'Error']);
  const messagesLeft = msgLimit > 0 ? Math.max(0, msgLimit - (sentTotal ?? 0)) : null;
  const activePlan = Number(user.u_wa_plan_status) === 1;
  const { fbAppId, fbConfigId } = config.meta;

  return (
    <>
      <PageTitle title="Dashboard" home="/dashboard" />
      <div className="row mb-3">
        <div className="col">
          <h4 className="fs-16 mb-1">Hello, {user.u_name}!</h4>
          <p className="text-muted mb-0">Here&apos;s what&apos;s happening with your WhatsApp account.</p>
        </div>
        <div className="col-auto">
          <form method="get" className="d-flex gap-2">
            <DateRangeInput name="dt_search" defaultValue={dtSearch} />
            <button type="submit" className="btn btn-soft-secondary" aria-label="Apply"><i className="ri-pulse-line" /></button>
          </form>
        </div>
      </div>

      <div className="row">
        <div className="col-xl-3 col-md-6">
          <div className="card card-animate">
            <div className="card-body">
              <p className="text-uppercase fw-medium text-muted mb-2">WA Status</p>
              {!user.u_wa_phone_id ? (
                <>
                  <p className="text-muted small mb-2">Connect your WhatsApp Business number to start sending.</p>
                  {fbAppId && fbConfigId
                    ? <WhatsAppSignup appId={fbAppId} configId={fbConfigId} />
                    : <span className="badge bg-warning-subtle text-warning">Ask your administrator to configure Facebook signup</span>}
                </>
              ) : (
                <div className="small lh-lg">
                  <div>Phone No.: <b>{user.u_wa_no || '—'}</b></div>
                  <div>Phone ID: <b>{user.u_wa_phone_id}</b></div>
                  <div>WABA ID: <b>{user.u_wa_b_id || '—'}</b></div>
                  <div>Business ID: <b>{user.u_business_id || '—'}</b></div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-md-6">
          <div className="card card-animate">
            <div className="card-body">
              <p className="text-uppercase fw-medium text-muted mb-2">Msg Sent (period)</p>
              <h4 className="fs-22 fw-semibold mb-3">{numberFormat(sentInRange)}</h4>
              <Link href="/reports" className="btn btn-secondary btn-sm">View</Link>
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-md-6">
          <div className="card card-animate">
            <div className="card-body">
              {messagesLeft !== null ? (
                <>
                  <p className="text-uppercase fw-medium text-muted mb-2">Messages Left</p>
                  <h4 className="fs-22 fw-semibold mb-1">{numberFormat(messagesLeft)}</h4>
                  <p className="text-muted small mb-0">{numberFormat(sentTotal ?? 0)} of {numberFormat(msgLimit)} used</p>
                </>
              ) : (
                <>
                  <p className="text-uppercase fw-medium text-muted mb-2">In Que</p>
                  <h4 className="fs-22 fw-semibold mb-3">{numberFormat(inQueue)}</h4>
                  <Link href="/que" className="btn btn-secondary btn-sm">View</Link>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-md-6">
          <div className="card card-animate">
            <div className="card-body">
              <p className="text-uppercase fw-medium text-muted mb-2">Valid Till</p>
              <h4 className={`fs-22 fw-semibold mb-1 ${activePlan ? '' : 'text-danger'}`}>
                {user.u_valid_till ? phpDate('M d, Y', user.u_valid_till) : '—'}
              </h4>
              {!activePlan && <p className="text-danger small mb-1">Plan expired — messages will not be sent.</p>}
              <Link href="/wa_plans" className="btn btn-info btn-sm">Recharge Now</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-xl-9">
          <div className="card">
            <div className="card-header"><h4 className="card-title mb-0">Templates — {dtSearch}</h4></div>
            <div className="card-body">
              <StatusMatrix matrix={templateReport} firstCol="Template" />
            </div>
          </div>
        </div>
        <div className="col-xl-3">
          <div className="card">
            <div className="card-body">
              <p className="text-uppercase fw-medium text-muted mb-2">Incoming (period)</p>
              <h4 className="fs-22 fw-semibold mb-3">{numberFormat(incoming ?? 0)}</h4>
              <Link href="/chat" className="btn btn-success btn-sm">Open Inbox</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

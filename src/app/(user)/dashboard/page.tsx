import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle } from '@/components/PageTitle';
import { StatusMatrix } from '@/components/StatusMatrix';
import { DateRangeInput } from '@/components/ui';
import { redirect } from 'next/navigation';
import { requireAccount, requireUser } from '@/lib/auth';
import { memberHome } from '@/lib/team';
import { config } from '@/lib/config';
import { query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { buildMatrix, TEMPLATE_TYPES } from '@/lib/services/reports';
import { numberFormat } from '@/lib/text';
import { addDays, dayStart, parseDateRange, phpDate, todayString } from '@/lib/time';
import { WhatsAppSignup } from './WhatsAppSignup';
import { MetaLimitCard, MetaLimitLoading } from './MetaLimitCard';
import { WhatsAppLinkCard } from './WhatsAppLinkCard';
import { signupIds } from '@/lib/services/meta';
import { sdkVersion } from '@/lib/services/graph-version';
import { USER_TYPE } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard' };

type Params = Promise<Record<string, string | string[] | undefined>>;

/** User dashboard (User\DashboardController::index). */
export default async function DashboardPage({ searchParams }: { searchParams: Params }) {
  // Team members don't see the account dashboard (balance, plan): they land on their first section
  const account = await requireAccount();
  if (account.member) redirect(memberHome(account.perms));
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
    // Template messages used so far (kept up to date by the sender, see services/template-limit.ts)
    Promise.resolve(msgLimit > 0 ? Number(user.u_msg_used ?? 0) : null),
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
  // WhatsApp user (account type 2) with "Coexistence (Mobile & Web)" on: only the Coexistence enroll; others: normal signup
  const coexistence = Number(user.u_type) === USER_TYPE.WHATSAPP && Number(user.u_wa_coexistence) === 1;
  const signup = !user.u_wa_phone_id || !user.u_wa_b_id ? { ...(await signupIds()), sdk: await sdkVersion() } : null;

  // The attached number in international form for wa.me (10 digits get the country code)
  const waDigits = String(user.u_wa_no ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const waNumber = waDigits.length === 10 ? config.countryCode + waDigits : waDigits.length > 10 && waDigits.length <= 15 ? waDigits : '';

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
          <div className="card card-animate card-height-100">
            <div className="card-body">
              <p className="text-uppercase fw-medium text-muted mb-2">WA Status</p>
              {signup ? (
                <>
                  <p className="text-muted small mb-2">
                    {user.u_wa_phone_id ? 'Your WhatsApp Business account (WABA) is not connected yet.' : 'Connect your WhatsApp Business number to start sending.'}
                  </p>
                  {(user.u_wa_phone_id || user.u_wa_b_id) && (
                    <div className="small lh-lg mb-2">
                      <div>Phone ID: <b>{user.u_wa_phone_id || <span className="text-danger">missing</span>}</b></div>
                      <div>WABA ID: <b>{user.u_wa_b_id || <span className="text-danger">missing</span>}</b></div>
                    </div>
                  )}
                  <WhatsAppSignup appId={signup.appId} configId={signup.configId} version={signup.sdk} coexistence={coexistence} />
                </>
              ) : (
                <div className="small lh-lg">
                  <div><span className="badge bg-success-subtle text-success"><i className="ri-checkbox-circle-line me-1" />Connected</span></div>
                  <div>Phone No.: <b>{user.u_wa_no || '—'}</b></div>
                </div>
              )}
              <div className="d-flex align-items-center flex-wrap gap-2 border-top pt-2 mt-2">
                <div className="me-auto small">
                  <div className="text-muted">Valid Till</div>
                  <b className={`fs-15 ${activePlan ? '' : 'text-danger'}`}>{user.u_valid_till ? phpDate('M d, Y', user.u_valid_till) : '—'}</b>
                </div>
                <Link href="/wa_plans" className="btn btn-info btn-sm">Recharge Now</Link>
                {!activePlan && <div className="text-danger small w-100">Plan expired — messages will not be sent.</div>}
              </div>
            </div>
          </div>
        </div>
        {waNumber && (
          <div className="col-xl-3 col-md-6">
            <WhatsAppLinkCard number={waNumber} />
          </div>
        )}
        <div className="col-xl-3 col-md-6">
          <div className="card card-animate card-height-100">
            <div className="card-body">
              <p className="text-uppercase fw-medium text-muted mb-2">Messages (period)</p>
              <div className="d-flex">
                {[
                  { label: 'Sent', icon: 'ri-send-plane-line text-primary', n: sentInRange, href: '/reports', link: 'View' },
                  { label: 'Incoming', icon: 'ri-inbox-archive-line text-success', n: incoming ?? 0, href: '/chat', link: 'Inbox' },
                  { label: 'In Que', icon: 'ri-time-line text-warning', n: inQueue, href: '/que', link: 'View' },
                ].map((m, i) => (
                  <div key={m.label} className={`flex-fill ${i ? 'border-start ps-2' : ''} ${i < 2 ? 'pe-2' : ''}`} style={{ minWidth: 0 }}>
                    <div className="text-muted small text-nowrap"><i className={`${m.icon} me-1`} />{m.label}</div>
                    <h4 className="fs-20 fw-semibold mb-1">{numberFormat(m.n)}</h4>
                    <Link href={m.href} className="small fw-medium text-nowrap">{m.link} <i className="ri-arrow-right-s-line align-middle" /></Link>
                  </div>
                ))}
              </div>
              {messagesLeft !== null && (
                <div className="small text-muted border-top pt-2 mt-2">
                  Messages left: <b className="text-body">{numberFormat(messagesLeft)}</b> · {numberFormat(sentTotal ?? 0)} of {numberFormat(msgLimit)} used
                </div>
              )}
            </div>
          </div>
        </div>
        {!signup && (
          <div className="col-xl-3 col-md-6">
            <Suspense fallback={<MetaLimitLoading />}>
              <MetaLimitCard user={user} />
            </Suspense>
          </div>
        )}
      </div>

      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-header"><h4 className="card-title mb-0">Templates — {dtSearch}</h4></div>
            <div className="card-body">
              <StatusMatrix matrix={templateReport} firstCol="Template" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

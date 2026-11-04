import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { query, value } from '@/lib/db';
import { numberFormat } from '@/lib/text';
import { dayStart, phpDate } from '@/lib/time';
import { USER_TYPE, type UserRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import type { Params } from '../_lib';

type Row = UserRow & { parent_company: string | null; parent_name: string | null };

/** WhatsApp user activity: sent today, in queue, last send (ReportController::waUsersActivity). */
export default async function WaUsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const perPage = config.site.pageSize;
  const today = dayStart();
  const queFrom = today - config.queTime;

  const where = 'u_dstatus = 0 AND u_type = $1 AND u_status = 1';
  const [users, total] = await Promise.all([
    query<Row>(
      `SELECT u.u_id, u.u_code, u.u_username, u.u_valid_till, u.u_wa_plan_status, u.u_wa_no, u.u_last_wa_send,
              p.u_company_name AS parent_company, p.u_name AS parent_name
         FROM (SELECT * FROM js_user WHERE ${where} ORDER BY u_name, u_id LIMIT $2 OFFSET $3) u
         LEFT JOIN js_user p ON p.u_id = u.u_parent_id
        ORDER BY u.u_name, u.u_id`,
      [USER_TYPE.WHATSAPP, perPage, (page - 1) * perPage],
    ),
    value<number>(`SELECT COUNT(*)::int FROM js_user WHERE ${where}`, [USER_TYPE.WHATSAPP]),
  ]);
  const ids = users.map((u) => u.u_id);

  const [sentToday, que] = ids.length
    ? await Promise.all([
      // "Sent today" by send time: js_message_sent_idx (m_user_id, m_in_process_on) WHERE m_status = 3 AND m_is_incoming = 2
      query<{ m_user_id: number; n: number }>(
        `SELECT m_user_id, COUNT(*)::int AS n FROM js_message
          WHERE m_status = 3 AND m_is_incoming = 2 AND m_user_id = ANY($1::int[]) AND m_in_process_on >= $2
            AND m_dstatus = 0 AND m_message_id <> ''
          GROUP BY 1`, [ids, today]),
      // js_message_queue_idx (m_user_id, m_id) WHERE m_status = 1 AND m_is_incoming = 2 AND m_dstatus = 0
      query<{ m_user_id: number; n: number }>(
        `SELECT m_user_id, COUNT(*)::int AS n FROM js_message
          WHERE m_status = 1 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_user_id = ANY($1::int[]) AND m_created_on >= $2
          GROUP BY 1`, [ids, queFrom]),
    ])
    : [[], []];
  const todayMap = new Map(sentToday.map((r) => [r.m_user_id, r.n]));
  const queMap = new Map(que.map((r) => [r.m_user_id, r.n]));

  return (
    <>
      <PageTitle title="WA Users Activity" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-body table-responsive">
          <table className="table table-sm table-striped align-middle table-report mb-0">
            <thead className="table-light"><tr><th>Code</th><th>Username</th><th>Company</th><th>Valid Till</th><th>WA No.</th><th className="num">Sent Today</th><th className="num">In Queue</th><th>Last Msg Sent</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.u_id}>
                  <td>{u.u_code}</td>
                  <td><Link href={`/wamaster/users/${u.u_id}`}>{u.u_username}</Link></td>
                  <td>{u.parent_company || u.parent_name}</td>
                  <td className={Number(u.u_wa_plan_status) === 1 ? '' : 'text-danger'}>{u.u_valid_till ? phpDate('d-m-Y', u.u_valid_till) : '—'}</td>
                  <td>{u.u_wa_no}</td>
                  <td className="num">{numberFormat(todayMap.get(u.u_id) ?? 0)}</td>
                  <td className="num">{numberFormat(queMap.get(u.u_id) ?? 0)}</td>
                  <td className="small">{u.u_last_wa_send ? phpDate('d M Y H:i', u.u_last_wa_send) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3"><Pagination path="/wamaster/reports/wa_users" params={sp} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}

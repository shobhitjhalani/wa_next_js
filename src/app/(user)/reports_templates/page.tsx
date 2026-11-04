import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { StatusMatrix } from '@/components/StatusMatrix';
import { DateRangeInput } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { sp } from '@/lib/http';
import { buildMatrix, TEMPLATE_TYPES } from '@/lib/services/reports';
import { dayStart, parseDateRange } from '@/lib/time';
import { dateInput, reportQuery, templateNames } from '../reports/query';

export const metadata: Metadata = { title: 'Templates Reports' };

const SUCCESS = 'Send / Delivered / Read';

/** Template × delivery status counts (User\ReportController::templates). */
export default async function TemplatesReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const dtInput = dateInput(params);
  const range = parseDateRange(dtInput);
  const queFrom = dayStart() - config.queTime;

  // Sent and API-error rows (status 3) in one grouped pass over (m_user_id, 2, 3, m_created_on)
  const args: unknown[] = [user.u_id, TEMPLATE_TYPES];
  const where = [`m_user_id = $1`, `m_is_incoming = 2`, `m_status = 3`, `m_dstatus = 0`, `m_msg_type = ANY($2::text[])`];
  const add = (sql: string, ...v: unknown[]) => {
    let s = sql;
    for (const x of v) { args.push(x); s = s.replace('?', `$${args.length}`); }
    where.push(s);
  };
  if (range) add('m_created_on BETWEEN ? AND ?', range[0], range[1]);
  if (sp(params, 'mobile_no')) add('m_mobile_no = ?', sp(params, 'mobile_no'));
  if (sp(params, 'template')) add('m_msg_template_name = ?', sp(params, 'template'));
  if (sp(params, 'status')) add('m_delivery_status = ?', sp(params, 'status'));

  const [sent, que, names] = await Promise.all([
    // Laravel: m_message_id != '' → by delivery status; m_message_id = '' → Error (NULL ids are in neither)
    // (reportQuery: bitmap scan of js_message_user_dir_status_idx, see reports/query.ts)
    reportQuery<{ name: string | null; err: boolean; ds: string | null; n: number }>(
      `SELECT m_msg_template_name AS name, m_message_id = '' AS err,
              CASE WHEN m_message_id = '' THEN NULL ELSE m_delivery_status END AS ds, COUNT(*)::int AS n
         FROM js_message
        WHERE ${where.join(' AND ')} AND m_message_id IS NOT NULL
        GROUP BY 1, 2, 3`,
      args,
    ),
    // Live queue (js_message_queue_idx), no filters as in Laravel
    query<{ name: string | null; n: number }>(
      `SELECT m_msg_template_name AS name, COUNT(*)::int AS n
         FROM js_message
        WHERE m_user_id = $1 AND m_status = 1 AND m_is_incoming = 2 AND m_dstatus = 0 AND m_created_on >= $2
        GROUP BY 1`,
      [user.u_id, queFrom],
    ),
    templateNames(user.u_id),
  ]);

  const rows = new Map<string, Record<string, number>>();
  const row = (name: string | null) => {
    const key = name ?? '';
    if (!rows.has(key)) rows.set(key, {});
    return rows.get(key)!;
  };
  for (const r of sent) {
    if (r.err) continue;
    const col = r.ds === null || ['', 'sent', 'delivered', 'read'].includes(r.ds) ? SUCCESS : r.ds;
    const target = row(r.name);
    target[col] = (target[col] ?? 0) + r.n;
  }
  for (const r of que) row(r.name).Que = r.n;
  for (const r of sent) if (r.err) row(r.name).Error = r.n;
  const matrix = buildMatrix(rows, ['Que', 'Error']);

  return (
    <>
      <PageTitle title="Templates Reports" home="/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3"><DateRangeInput name="wa_date" defaultValue={dtInput} placeholder="Date range" /></div>
            <div className="col-md-3">
              <select className="form-select" name="template" aria-label="Template" defaultValue={sp(params, 'template')}>
                <option value="">All templates</option>
                {names.map((name, i) => <option key={i} value={name}>{name}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <select className="form-select" name="status" aria-label="Delivery status" defaultValue={sp(params, 'status')}>
                <option value="">All statuses</option>
                {Object.entries(config.deliveryStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="col-md-2"><input type="text" className="form-control" name="mobile_no" defaultValue={sp(params, 'mobile_no')} placeholder="Mobile No" aria-label="Mobile number" /></div>
            <div className="col-auto"><button type="submit" className="btn btn-secondary">Search</button></div>
          </form>
        </div>
        <div className="card-body">
          <StatusMatrix matrix={matrix} firstCol="Template Name" />
        </div>
      </div>
    </>
  );
}

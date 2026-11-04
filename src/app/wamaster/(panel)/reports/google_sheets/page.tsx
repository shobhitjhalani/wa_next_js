import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { like, query, value } from '@/lib/db';
import { masterCodeOptions } from '@/lib/models';
import { numberFormat } from '@/lib/text';
import { phpDate } from '@/lib/time';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { corporates, filled, input, intParam, type Params } from '../_lib';

interface SheetRow {
  us_id: number;
  us_user_id: number;
  us_sheet_type: number;
  us_sheet_id: string | null;
  us_created_on: number;
  us_status: number;
  u_company_name: string | null;
  u_name: string | null;
  u_code: string | null;
  ue_email_id: string | null;
}

/** Activated Google Sheets (ReportController::sheets). */
export default async function GoogleSheetsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const perPage = config.site.pageSize;
  const args: unknown[] = [
    filled(sp, 'user_id') ? intParam(sp, 'user_id') : null,
    filled(sp, 'sheet_id') ? like(input(sp, 'sheet_id') ?? '') : null,
    filled(sp, 'st') ? intParam(sp, 'st') : null,
  ];
  const from = `FROM js_user_active_sheets s
    JOIN js_user u ON u.u_id = s.us_user_id
    LEFT JOIN js_user_emails e ON e.ue_id = s.us_user_email_id
   WHERE s.us_dstatus = 0
     AND ($1::int IS NULL OR s.us_user_id = $1)
     AND ($2::text IS NULL OR s.us_sheet_id ILIKE '%' || $2 || '%')
     AND ($3::int IS NULL OR s.us_status = $3)`;

  const [sheets, count, total, sheetTypes, corps] = await Promise.all([
    query<SheetRow>(
      `SELECT s.us_id, s.us_user_id, s.us_sheet_type, s.us_sheet_id, s.us_created_on, s.us_status, u.u_company_name, u.u_name, u.u_code, e.ue_email_id
       ${from} ORDER BY s.us_id DESC LIMIT $4 OFFSET $5`,
      [...args, perPage, (page - 1) * perPage],
    ),
    value<number>(`SELECT COUNT(*)::int ${from}`, args),
    value<number>('SELECT COUNT(*)::int FROM js_user_active_sheets WHERE us_dstatus = 0 AND us_status = 1'),
    masterCodeOptions(config.masters.sheetType),
    corporates(),
  ]);
  const typeName = new Map(sheetTypes.map((t) => [String(t.value), t.label]));

  return (
    <>
      <PageTitle title="Google Sheets" home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header">
          <form method="get" className="row g-2 align-items-center filter-bar">
            <div className="col-md-3">
              <select className="form-select" name="user_id" defaultValue={input(sp, 'user_id') ?? ''} aria-label="Corporate user">
                <option value="">All corporate users</option>
                {corps.map((u) => <option key={u.u_id} value={String(u.u_id)}>{u.u_name}</option>)}
              </select>
            </div>
            <div className="col-md-3"><input className="form-control" name="sheet_id" defaultValue={input(sp, 'sheet_id') ?? ''} placeholder="Sheet ID" aria-label="Sheet ID" /></div>
            <div className="col-md-2">
              <select className="form-select" name="st" defaultValue={input(sp, 'st') ?? ''} aria-label="Status">
                <option value="">All</option>
                <option value="1">Active</option>
                <option value="2">Inactive</option>
              </select>
            </div>
            <div className="col-auto"><button className="btn btn-secondary">Search</button></div>
            <div className="col-auto ms-auto text-muted">{numberFormat(total ?? 0)} active sheets</div>
          </form>
        </div>
        <div className="card-body table-responsive">
          <table className="table table-sm table-striped align-middle mb-0">
            <thead className="table-light"><tr><th>Sheet ID</th><th>Type</th><th>Code</th><th>Company</th><th>User Email</th><th>Activated</th><th>Status</th></tr></thead>
            <tbody>
              {sheets.length ? sheets.map((s) => (
                <tr key={s.us_id}>
                  <td className="small text-break">{s.us_sheet_id}</td>
                  <td>{typeName.get(String(s.us_sheet_type)) ?? ''}</td>
                  <td>{s.u_code}</td>
                  <td><Link href={`/wamaster/users/${s.us_user_id}`}>{s.u_company_name || s.u_name}</Link></td>
                  <td>{s.ue_email_id}</td>
                  <td>{s.us_created_on ? phpDate('d-m-Y', s.us_created_on) : ''}</td>
                  <td><span className={`badge ${Number(s.us_status) === 1 ? 'bg-success' : 'bg-secondary'}`}>{Number(s.us_status) === 1 ? 'Active' : 'Inactive'}</span></td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="text-center text-muted py-4">No sheets.</td></tr>
              )}
            </tbody>
          </table>
          <div className="mt-3"><Pagination path="/wamaster/reports/google_sheets" params={sp} page={page} perPage={perPage} total={count ?? 0} /></div>
        </div>
      </div>
    </>
  );
}

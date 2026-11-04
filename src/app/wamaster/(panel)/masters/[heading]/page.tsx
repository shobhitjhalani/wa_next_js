import Link from 'next/link';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { like, query, value } from '@/lib/db';
import { sp } from '@/lib/http';
import { numberFormat } from '@/lib/text';
import type { MasterValueRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { Pagination, pageParam } from '@/components/Pagination';
import { ConfirmButton } from '@/components/ui';
import { deleteMaster } from './actions';
import { findHeading, masterFields, namesOf, selectHeading } from './_lib';

type Params = Record<string, string | string[] | undefined>;

/** Data master values of one heading (MasterController::index). */
export default async function MastersPage({ params, searchParams }: { params: Promise<{ heading: string }>; searchParams: Promise<Params> }) {
  await requireAdminCan('masters');
  const [{ heading }, sparams] = await Promise.all([params, searchParams]);
  const head = await findHeading(heading);
  const fields = masterFields(head.mh_id);
  const q = sp(sparams, 'q');
  const page = pageParam(sparams.page);
  const perPage = config.site.pageSize;

  const where = `mv_type = $1 AND mv_dstatus = 0 AND ($2 = '' OR mv_name ILIKE '%' || $2 || '%')`;
  const [rows, total] = await Promise.all([
    query<MasterValueRow>(
      `SELECT * FROM js_master_value WHERE ${where} ORDER BY mv_display_order, mv_name LIMIT $3 OFFSET $4`,
      [head.mh_id, like(q), perPage, (page - 1) * perPage],
    ),
    value<number>(`SELECT COUNT(*)::int FROM js_master_value WHERE ${where}`, [head.mh_id, like(q)]),
  ]);

  const selectKeys = fields.filter(([, , kind]) => selectHeading(kind) !== null).map(([key]) => key);
  const names = await namesOf(rows.flatMap((r) => selectKeys.map((k) => r['mv_' + k])));
  const shown = fields.filter(([key]) => key !== 'desc');
  const base = `/wamaster/masters/${head.mh_id}`;

  return (
    <>
      <PageTitle title={head.mh_name ?? ''} home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-header d-flex flex-wrap gap-2 align-items-center">
          <form method="get" className="d-flex gap-2 me-auto">
            <input type="text" className="form-control" name="q" defaultValue={q} placeholder="Search name" aria-label="Search" />
            <button className="btn btn-secondary">Search</button>
          </form>
          <Link href={`${base}/create`} className="btn btn-primary"><i className="ri-add-line" /> Add {head.mh_name}</Link>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle table-striped mb-0">
              <thead className="table-light">
                <tr>
                  {shown.map(([key, label]) => <th key={key}>{label}</th>)}
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((row) => (
                  <tr key={row.mv_id}>
                    {shown.map(([key, , kind]) => {
                      const v = row['mv_' + key];
                      let out: React.ReactNode;
                      if (selectHeading(kind) !== null) out = v ? names.get(String(v).trim()) ?? '' : '';
                      else if (kind === 'plan_type') out = config.planTypes[Number(row.mv_value1)] ?? '';
                      else if (kind === 'decimal') out = `Rs. ${numberFormat(v, 2)}`;
                      else out = v == null ? '' : String(v);
                      return <td key={key}>{out}</td>;
                    })}
                    <td><span className={`badge ${Number(row.mv_status) === 1 ? 'bg-success' : 'bg-secondary'}`}>{Number(row.mv_status) === 1 ? 'Active' : 'Inactive'}</span></td>
                    <td className="text-nowrap text-end">
                      <Link href={`${base}/${row.mv_id}/edit`} className="btn btn-sm btn-soft-secondary" aria-label="Edit"><i className="ri-pencil-fill" /></Link>{' '}
                      <form action={deleteMaster.bind(null, head.mh_id, row.mv_id)} className="d-inline">
                        <ConfirmButton message="Delete this record?" className="btn btn-sm btn-soft-danger" aria-label="Delete"><i className="ri-delete-bin-fill" /></ConfirmButton>
                      </form>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={fields.length + 2} className="text-center text-muted py-4">No records.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><Pagination path={base} params={sparams} page={page} perPage={perPage} total={total ?? 0} /></div>
        </div>
      </div>
    </>
  );
}

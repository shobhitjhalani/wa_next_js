import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { Alert, Empty, PageTitle, Pagination } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { hasRight } from "@/lib/admin/rights";
import { int, page, str, type SearchParams } from "@/lib/admin/params";
import { ACTIVE_INACTIVE } from "@/lib/admin/constants";
import { numberFormat, ucfirst } from "@/lib/admin/format";
import { heading, masterLayout } from "@/lib/admin/masters";
import { deleteMasterAction } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

// wamaster/view/masters/index.php?h=<heading id>
export default async function MastersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const h = int(sp, "h");
  if (!h || !(await hasRight(admin, "masters", "View"))) redirect("/wamaster/dashboard");
  const head = await heading(h);
  const layout = masterLayout(h);
  const title = str(sp, "title");
  const current = page(sp);
  const where = { mv_dstatus: 0, mv_type: h, ...(title ? { mv_name: { contains: title, mode: "insensitive" as const } } : {}) };
  const [total, rows, canEdit, canDelete] = await Promise.all([
    db.js_master_value.count({ where }),
    db.js_master_value.findMany({ where, orderBy: h === 82 ? [{ mv_value1: "asc" }, { mv_display_order: "asc" }] : { mv_name: "asc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    hasRight(admin, "masters", "Edit"),
    hasRight(admin, "masters", "Delete"),
  ]);
  const lookupIds = layout.columns.filter((c) => c.lookup).flatMap((c) => rows.map((r) => Number(r[c.field]) || 0)).filter((x) => x > 0);
  const lookups = lookupIds.length ? await db.js_master_value.findMany({ where: { mv_id: { in: lookupIds.map(BigInt) } }, select: { mv_id: true, mv_name: true } }) : [];
  const nameOf = new Map(lookups.map((l) => [Number(l.mv_id), l.mv_name]));
  const pageTitle = head?.name ?? `Masters (${h})`;
  const colSpan = layout.columns.length + 2;

  return (
    <AdminShell admin={admin} group="masters">
      <PageTitle title={pageTitle} />
      <Alert msg={str(sp, "saved") ? "Record Successfully Saved" : ""} />
      <div className="card">
        <div className="card-header align-items-center d-flex">
          <h4 className="card-title mb-0 flex-grow-1">{pageTitle}</h4>
          {canEdit && (
            <a href={`/wamaster/view/masters/add?h=${h}`} className="btn btn-primary">
              Add New {pageTitle}
            </a>
          )}
        </div>
        <div className="card-body">
          <form method="get" className="row g-2 mb-3">
            <input type="hidden" name="h" value={h} />
            <div className="col-md-4">
              <input type="text" name="title" className="form-control" defaultValue={title} placeholder="Title" />
            </div>
            <div className="col-auto">
              <button className="btn btn-secondary" type="submit">
                Search
              </button>
            </div>
          </form>
          <div className="table-responsive">
            <table className="table align-middle table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  {layout.columns.map((c) => (
                    <th key={c.field}>{c.label}</th>
                  ))}
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <Empty colSpan={colSpan} />}
                {rows.map((r) => (
                  <tr key={String(r.mv_id)}>
                    {layout.columns.map((c) => {
                      const raw = r[c.field];
                      const v = c.lookup ? nameOf.get(Number(raw)) : c.field === "mv_value_decimal" ? `Rs.${numberFormat(Number(raw), 2)}` : String(raw ?? "");
                      return <td key={c.field}>{c.field === "mv_name" ? ucfirst(String(v)) : v}</td>;
                    })}
                    <td>{ACTIVE_INACTIVE[r.mv_status] ?? r.mv_status}</td>
                    <td className="d-flex gap-1">
                      {canEdit && (
                        <a className="btn btn-sm btn-secondary" href={`/wamaster/view/masters/add?h=${h}&id=${r.mv_id}`}>
                          <i className="ri-edit-2-line"></i>
                        </a>
                      )}
                      {canDelete && (
                        <form action={deleteMasterAction}>
                          <input type="hidden" name="h" value={h} />
                          <input type="hidden" name="id" value={String(r.mv_id)} />
                          <ConfirmButton className="btn btn-sm btn-danger" message="Are you sure to delete this detail">
                            <i className="ri-delete-bin-line"></i>
                          </ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                <Pagination total={total} pageSize={PAGE_SIZE} current={current} sp={sp} colSpan={colSpan} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

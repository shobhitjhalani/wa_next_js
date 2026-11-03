import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ActionForm from "@/components/admin/ActionForm";
import { Card, PageTitle } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { hasRight } from "@/lib/admin/rights";
import { int, type SearchParams } from "@/lib/admin/params";
import { heading, masterLayout } from "@/lib/admin/masters";
import { saveMasterAction } from "../actions";

export const dynamic = "force-dynamic";

// wamaster/view/masters/add.php (generic fields per heading; see docs/migration-notes/admin-panel.md)
export default async function MasterAddPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const h = int(sp, "h");
  const id = int(sp, "id");
  if (!h || !(await hasRight(admin, "masters", id ? "Edit" : "Add"))) redirect("/wamaster/dashboard");
  const row = id ? await db.js_master_value.findFirst({ where: { mv_id: BigInt(id), mv_type: h, mv_dstatus: 0 } }) : null;
  if (id && !row) redirect(`/wamaster/view/masters?h=${h}`);
  const head = await heading(h);
  const title = head?.name ?? `Masters (${h})`;

  return (
    <AdminShell admin={admin} group="masters">
      <PageTitle title={title} />
      <Card title={`${id ? "Edit" : "Add"} ${title}`}>
        <ActionForm action={saveMasterAction}>
          <input type="hidden" name="h" value={h} />
          {id && <input type="hidden" name="id" value={id} />}
          <div className="row">
            {masterLayout(h).form.map((f) => (
              <div key={f.field} className="col-md-4 mb-3">
                <label>{f.label}:</label>
                <input
                  className="form-control"
                  name={f.field}
                  defaultValue={row ? String(row[f.field] ?? "") : ""}
                  required={f.field === "mv_name"}
                  type={f.field === "mv_display_order" || f.field === "mv_value_decimal" ? "number" : "text"}
                  step={f.field === "mv_value_decimal" ? "0.01" : undefined}
                />
              </div>
            ))}
            <div className="col-md-2 mb-3">
              <label>Status:</label>
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" name="mv_status" value="1" defaultChecked={!row || row.mv_status === 1} />
              </div>
            </div>
          </div>
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-success">
              Save
            </button>
            <a className="btn btn-light" href={`/wamaster/view/masters?h=${h}`}>
              Back
            </a>
          </div>
        </ActionForm>
      </Card>
    </AdminShell>
  );
}

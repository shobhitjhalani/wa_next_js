import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import EmployeeDetails from "@/components/admin/EmployeeDetails";
import { Alert, Card, PageTitle } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, str, type SearchParams } from "@/lib/admin/params";

export const dynamic = "force-dynamic";

// wamaster/view/teams/view.php
export default async function TeamViewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const sp = await searchParams;
  const e = await db.js_employee.findFirst({ where: { emp_id: int(sp, "id") ?? 0, emp_dstatus: 0 } });
  if (!e) redirect("/wamaster/view/teams");
  return (
    <AdminShell admin={admin} group="teams">
      <PageTitle title="Team Members" />
      <Alert msg={str(sp, "saved") ? "Record Successfully Saved" : ""} />
      <Card title={e.emp_name}>
        <EmployeeDetails e={e} />
        <div className="d-flex gap-2">
          <a href="/wamaster/view/teams" className="btn btn-light">
            Back
          </a>
          <a href={`/wamaster/view/teams/add?id=${e.emp_id}`} className="btn btn-danger">
            Edit
          </a>
        </div>
      </Card>
    </AdminShell>
  );
}

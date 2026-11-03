import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import EmployeeDetails from "@/components/admin/EmployeeDetails";
import { Card, PageTitle } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

// wamaster/profile.php
export default async function ProfilePage() {
  const admin = await getAdmin();
  const e = await db.js_employee.findFirst({ where: { emp_id: admin.empId, emp_dstatus: 0 } });
  if (!e) redirect("/wamaster/logout");
  return (
    <AdminShell admin={admin} group="">
      <PageTitle title="My Profile" />
      <Card title="My Profile">
        <EmployeeDetails e={e} />
        <a href="/wamaster/change_password" className="btn btn-primary">
          Change Password
        </a>
      </Card>
    </AdminShell>
  );
}

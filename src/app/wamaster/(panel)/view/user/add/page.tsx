import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import UserForm, { type UserFormValues } from "@/components/admin/UserForm";
import { Card, PageTitle } from "@/components/admin/ui";
import { getAdmin } from "@/lib/admin/guard";
import { hasRight } from "@/lib/admin/rights";
import { int, type SearchParams } from "@/lib/admin/params";
import { MV_TYPE } from "@/lib/admin/constants";
import { companyList, employeeList, findUserFor, masterList, userTypeName } from "@/lib/admin/users";
import { saveUserAction } from "../actions";

export const dynamic = "force-dynamic";

// wamaster/view/user/add.php
export default async function UserAddPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const ut = int(sp, "ut") ?? 2;
  const id = int(sp, "id");
  if (!(await hasRight(admin, "user", id ? "Edit" : "Add"))) redirect(`/wamaster/view/user?ut=${ut}`);

  const user = id ? await findUserFor(admin, id, ut) : null;
  if (id && !user) redirect(`/wamaster/view/user?ut=${ut}`);

  // Form keys are the column names without the u_ prefix, like the PHP @extract($data).
  const v: UserFormValues = user
    ? Object.fromEntries(Object.entries(user).filter(([k]) => k !== "u_password").map(([k, val]) => [k.replace(/^u_/, ""), typeof val === "bigint" ? Number(val) : typeof val === "object" ? null : (val as string | number)]))
    : { status: "1" };

  const [title, companies, countries, states, employees] = await Promise.all([
    userTypeName(ut),
    companyList(),
    masterList(MV_TYPE.Country),
    masterList(MV_TYPE.State),
    employeeList(),
  ]);

  return (
    <AdminShell admin={admin} group="user">
      <PageTitle title={title} />
      <Card title={`${id ? "Edit" : "Add"} ${title}`}>
        <UserForm
          action={saveUserAction}
          ut={ut}
          id={id}
          v={v}
          companies={companies.map((c) => ({ id: c.u_id, name: c.u_company_name || c.u_name || "" }))}
          countries={countries.map((c) => ({ id: Number(c.mv_id), name: c.mv_name ?? "" }))}
          states={states.map((c) => ({ id: Number(c.mv_id), name: c.mv_name ?? "" }))}
          employees={employees.map((e) => ({ id: e.emp_id, name: e.emp_name ?? "" }))}
          backHref={`/wamaster/view/user?ut=${ut}`}
        />
      </Card>
    </AdminShell>
  );
}

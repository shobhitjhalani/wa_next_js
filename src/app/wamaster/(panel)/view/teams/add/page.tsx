import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ActionForm from "@/components/admin/ActionForm";
import { Card, PageTitle } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, type SearchParams } from "@/lib/admin/params";
import { saveTeamMemberAction } from "@/lib/admin/team-actions";

export const dynamic = "force-dynamic";

// wamaster/view/teams/add.php
export default async function TeamAddPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  const id = int(await searchParams, "id");
  const e = id ? await db.js_employee.findFirst({ where: { emp_id: id, emp_dstatus: 0 } }) : null;
  if (id && !e) redirect("/wamaster/view/teams");

  const field = (label: string, name: string, value: string | null | undefined, opts: { type?: string; required?: boolean; maxLength?: number } = {}) => (
    <div className="col-md-4 mb-3">
      <label>{label}</label>
      <input className="form-control" name={name} defaultValue={value ?? ""} type={opts.type ?? "text"} required={opts.required} maxLength={opts.maxLength} />
    </div>
  );

  return (
    <AdminShell admin={admin} group="teams">
      <PageTitle title="Team Members" />
      <Card title={id ? "Edit Team Member" : "Add Team Member"}>
        <ActionForm action={saveTeamMemberAction}>
          {id && <input type="hidden" name="id" value={id} />}
          <div className="row">
            {field("Name:", "data[name]", e?.emp_name, { required: true })}
            {field("Primary Email ID:", "data[email_id]", e?.emp_email_id, { type: "email", required: true })}
            {field("Mobile No:", "data[mobile]", e?.emp_mobile, { required: true, maxLength: 10 })}
            {field("Username:", "data[username]", e?.emp_username)}
            <div className="col-md-4 mb-3">
              <label>Password (Leave Blank to Unchnage):</label>
              <input className="form-control" name="txtpassword" type="text" autoComplete="new-password" />
            </div>
            <div className="col-md-2 mb-3">
              <label>Status:</label>
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" role="switch" name="data[status]" value="1" defaultChecked={!e || e.emp_status === 1} />
              </div>
            </div>
          </div>
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-success">
              Save
            </button>
            <a href="/wamaster/view/teams" className="btn btn-light btn-label ms-auto">
              Back <i className="ri-arrow-left-line label-icon align-middle fs-16 me-2"></i>
            </a>
          </div>
        </ActionForm>
      </Card>
    </AdminShell>
  );
}

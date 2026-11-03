import AdminShell from "@/components/admin/AdminShell";
import ActionForm from "@/components/admin/ActionForm";
import { Card, PageTitle } from "@/components/admin/ui";
import { getAdmin } from "@/lib/admin/guard";
import { changeOwnPasswordAction } from "@/lib/admin/team-actions";

export const dynamic = "force-dynamic";

// wamaster/change_password.php
export default async function ChangePasswordPage() {
  const admin = await getAdmin();
  return (
    <AdminShell admin={admin} group="">
      <PageTitle title="Change Password" />
      <Card title="Change Password">
        <ActionForm action={changeOwnPasswordAction}>
          <div className="row">
            {[
              ["Current Password:", "txtcpswrd"],
              ["New Password:", "txtnpswrd"],
              ["Confirm Password:", "txtrpswrd"],
            ].map(([label, name]) => (
              <div key={name} className="col-md-4 mb-3">
                <label>{label}</label>
                <input type="password" className="form-control" name={name} required autoComplete={name === "txtcpswrd" ? "current-password" : "new-password"} />
              </div>
            ))}
          </div>
          <button type="submit" className="btn btn-success">
            Save
          </button>
        </ActionForm>
      </Card>
    </AdminShell>
  );
}

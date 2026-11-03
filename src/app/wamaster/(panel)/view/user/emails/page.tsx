import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ActionForm from "@/components/admin/ActionForm";
import { Card, PageTitle } from "@/components/admin/ui";
import { getAdmin } from "@/lib/admin/guard";
import { int, type SearchParams } from "@/lib/admin/params";
import { findUserFor, userTypeName } from "@/lib/admin/users";
import { saveGmailAction } from "../actions";

export const dynamic = "force-dynamic";

// wamaster/view/user/emails.php (opened in a fancybox popup in PHP; a normal page here)
export default async function GmailEmailPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const ut = int(sp, "ut") ?? 1;
  const user = await findUserFor(admin, int(sp, "id") ?? 0);
  if (!user) redirect(`/wamaster/view/user?ut=${ut}`);
  const title = await userTypeName(ut);

  return (
    <AdminShell admin={admin} group="user">
      <PageTitle title={title} />
      <Card title={`Add GMail account for ${user.u_name ?? ""}`}>
        <ActionForm action={saveGmailAction}>
          <input type="hidden" name="id" value={user.u_id} />
          <input type="hidden" name="ut" value={ut} />
          <div className="row">
            <div className="col-md-4 mb-3">
              <label>GMail Email ID:</label>
              <input type="email" className="form-control" name="data[email_id]" required />
            </div>
            <div className="col-md-2 mb-3">
              <label>Status:</label>
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" role="switch" name="data[status]" value="1" defaultChecked />
              </div>
            </div>
            <div className="col-md-3 mb-3">
              <label>Sheet Limit:</label>
              <input type="text" className="form-control" name="data[sheet_limit]" />
            </div>
          </div>
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-success">
              Save
            </button>
            <a href={`/wamaster/view/user/view?ut=${ut}&id=${user.u_id}`} className="btn btn-light">
              Back
            </a>
          </div>
        </ActionForm>
      </Card>
    </AdminShell>
  );
}

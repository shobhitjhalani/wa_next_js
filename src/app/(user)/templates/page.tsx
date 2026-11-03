import { revalidatePath } from "next/cache";
import { ConfirmLink, ConfirmSubmit } from "@/components/user/ConfirmSubmit";
import PageShell, { Card } from "@/components/user/PageShell";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/user/current";
import { decodeEntities, PA_STATUS, phpDate } from "@/lib/user/format";
import { activeTemplates, deleteTemplate, syncTemplatesFromMeta } from "@/lib/user/templates";

async function remove(form: FormData) {
  "use server";
  const user = await currentUser();
  await deleteTemplate(user.u_id, Number(form.get("id")));
  revalidatePath("/templates");
}

type SP = Promise<Record<string, string | string[] | undefined>>;

// templates.php — refreshes the list from Meta on every visit, like the PHP page.
export default async function TemplatesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const sync = await syncTemplatesFromMeta(user);
  const title = typeof sp.title === "string" ? sp.title.trim() : "";
  const [templates, parent] = await Promise.all([
    activeTemplates(user.u_id, title || undefined),
    user.u_parent_id > 0
      ? db.js_user.findUnique({ where: { u_id: user.u_parent_id }, select: { u_own_account: true } })
      : null,
  ]);
  const ownAccount = parent?.u_own_account ?? null;

  return (
    <PageShell title="WA Templates">
      <Card>
        <div className="card-header align-items-center d-flex">
          <div>
            {ownAccount === 2 && user.u_business_id && (
              <a
                href={`https://business.facebook.com/latest/whatsapp_manager/message_templates?business_id=${user.u_business_id}&tab=message-templatesnav_ref=whatsapp_manager&asset_id=${user.u_wa_b_id ?? ""}`}
                target="_blank"
                rel="noreferrer"
                id="addRow"
                className="btn btn-primary"
              >
                Add New Template
              </a>
            )}
            {user.u_id === 48 && (
              <a href="/create" id="create" className="btn btn-primary ms-2">Create New Carousel Template</a>
            )}
          </div>
        </div>
        <div className="card-body">
          {sync.error && <div className="alert alert-warning mb-3">Could not refresh templates from WhatsApp: {sync.error}</div>}
          <form method="get">
            <div className="row g-3 align-items-center">
              <div className="col-3">
                <input type="text" className="form-control" name="title" defaultValue={title} placeholder="Title" />
              </div>
              <div className="col-1">
                <button type="submit" className="btn btn-secondary">Search</button>
              </div>
            </div>
          </form>
        </div>
        <div className="card-body">
          <div className="live-preview">
            <div className="table-responsive table-card">
              <h3>Total Records : {templates.length}</h3>
              <table className="table align-middle table-nowrap table-striped-columns mb-0">
                <thead className="table-light">
                  <tr>
                    <th></th>
                    <th>S. No.</th>
                    <th>Created Date</th>
                    <th>Template Name</th>
                    <th>Content</th>
                    <th>Attachment</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t, i) => (
                    <tr key={t.ut_id}>
                      <td>
                        <a className="btn btn-success btn-sm" href={`/compose?tm=${t.ut_id}&s=false`}>Send Template</a>
                      </td>
                      <td>{i + 1}</td>
                      <td>{phpDate("d M y H:i", t.ut_created_on)}</td>
                      <td>{decodeEntities(t.ut_name)}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{decodeEntities(t.ut_message)}</td>
                      <td>
                        {(t.ut_file ?? "").split(",").filter(Boolean).map((f) => (
                          <span key={f}>
                            <a href={`${config.mediaUrl}watemplate/${f}`} target="_blank" rel="noreferrer">{f}</a>
                            <br />
                          </span>
                        ))}
                      </td>
                      <td>{PA_STATUS[String(t.ut_status)]}</td>
                      <td>{PA_STATUS[t.ut_template_type]}</td>
                      <td>
                        <ConfirmLink href={`/templates_add?id=${t.ut_id}`} className="btn btn-sm btn-secondary btn-icon btn-icon-sm" title="Edit">
                          <i className=" ri-pencil-fill"></i>
                        </ConfirmLink>{" "}
                        <form action={remove} className="d-inline">
                          <input type="hidden" name="id" value={t.ut_id} />
                          <ConfirmSubmit className="btn btn-sm btn-danger btn-icon btn-icon-sm" title="Delete">
                            <i className="ri-delete-bin-fill"></i>
                          </ConfirmSubmit>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

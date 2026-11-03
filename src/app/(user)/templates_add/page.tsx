import { redirect } from "next/navigation";
import AttachmentInputs from "@/components/user/AttachmentInputs";
import PageShell, { Alert, Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { decodeEntities } from "@/lib/user/format";
import { getTemplate, saveTemplate } from "@/lib/user/templates";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function save(form: FormData) {
  "use server";
  const user = await currentUser();
  const err = await saveTemplate(user.u_id, form);
  const id = Number(form.get("id") ?? 0);
  if (err) redirect(`/templates_add?${new URLSearchParams({ ...(id ? { id: String(id) } : {}), msg: err })}`);
  redirect("/templates");
}

// templates_add.php — create / edit a local template. (Delete is a POST from /templates.)
export default async function TemplatesAddPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const id = Number(sp.id ?? 0);
  const t = id > 0 ? await getTemplate(user.u_id, id) : null;
  const title = t ? "Update WA Templates" : "Create WA Templates";
  const files = (t?.ut_file ?? "").split(",").filter(Boolean);
  return (
    <PageShell title={title} crumbs={[{ href: "/templates", label: "WA Templates" }]}>
      <Card>
        <div className="card-body">
          <Alert msg={typeof sp.msg === "string" ? sp.msg : ""} />
          <div className="live-preview">
            <form action={save}>
              {t && <input type="hidden" name="id" value={t.ut_id} />}
              <div className="row">
                <div className="col-md-6">
                  <div className="mb-3">
                    <label htmlFor="txt_name" className="form-label">Title</label>
                    <input type="text" className="form-control" name="txt_name" id="txt_name" autoComplete="off" required
                      defaultValue={decodeEntities(t?.ut_name)} placeholder="Enter your Title" />
                  </div>
                </div>
                <div className="col-md-12">
                  <div className="mb-3">
                    <label htmlFor="txt_message" className="form-label">Content</label>
                    <textarea name="txt_message" required id="txt_message" className="form-control" style={{ resize: "none" }}
                      rows={10} defaultValue={decodeEntities(t?.ut_message)} />
                  </div>
                </div>
              </div>
              <AttachmentInputs existing={files} />
              <div className="row">
                <div className="col-lg-12">
                  <div className="text-start">
                    <button type="submit" className="btn btn-success">Save</button>{" "}
                    <a href="/templates" className="btn btn-warning">Back</a>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

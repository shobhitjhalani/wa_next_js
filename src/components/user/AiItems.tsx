import { ConfirmLink, ConfirmSubmit } from "./ConfirmSubmit";
import PageShell, { Alert, Card } from "./PageShell";
import { decodeEntities, phpDate, toUnix } from "@/lib/user/format";
import type { AiItem } from "@/lib/user/ai";

// knowledge_base.php / prompts.php: list + add/edit form.
export default function AiItems({
  title,
  path,
  items,
  editing,
  msg,
  save,
  remove,
}: {
  title: string;
  path: string;
  items: AiItem[];
  editing: AiItem | null;
  msg: string;
  save: (form: FormData) => Promise<void>;
  remove: (form: FormData) => Promise<void>;
}) {
  return (
    <PageShell title={title}>
      <Card>
        <div className="card-header align-items-center d-flex">
          <a id="addRow" href={`${path}?s=false&type=add`} className="btn btn-primary">Add New {title}</a>
        </div>
        <div className="card-body">
          <Alert msg={msg} kind="success" />
          {items.length > 0 && (
            <div className="table-responsive table-card mb-4">
              <table className="table align-middle table-nowrap table-striped-columns mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Last Updated On</th>
                    <th> Name</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td>{phpDate("d M y H:i", toUnix(it.updated))}</td>
                      <td>{decodeEntities(it.title)}</td>
                      <td>
                        <ConfirmLink href={`${path}?type=update&id=${it.id}`} className="btn btn-sm btn-secondary btn-icon btn-icon-sm" title="Edit">
                          <i className=" ri-pencil-fill"></i>
                        </ConfirmLink>{" "}
                        <form action={remove} className="d-inline">
                          <input type="hidden" name="id" value={it.id} />
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
          )}
          <form action={save}>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label htmlFor="title" className="form-label">Title</label>
                <input name="title" id="title" className="form-control" defaultValue={decodeEntities(editing?.title)} />
              </div>
              <div className="col-md-6 mb-3">
                <label htmlFor="keywords" className="form-label">Keywords</label>
                <input name="keywords" id="keywords" className="form-control" defaultValue={decodeEntities(editing?.keywords)} />
              </div>
              <div className="col-md-12 mb-3">
                <label htmlFor="content" className="form-label">Content</label>
                <textarea name="content" id="content" style={{ resize: "none" }} className="form-control" rows={10}
                  defaultValue={decodeEntities(editing?.content)} />
              </div>
            </div>
            {editing && <input name="kbid" type="hidden" value={editing.id} />}
            <button type="submit" className="btn btn-success">Save</button>
          </form>
        </div>
      </Card>
    </PageShell>
  );
}

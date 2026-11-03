import { SelectAll } from "./ConfirmSubmit";
import { DateRangeInput, SearchButton, SelectFilter, TextFilter } from "./Filters";
import PageShell, { Card } from "./PageShell";
import Pager from "./Pager";
import { decodeEntities, phpDate } from "@/lib/user/format";
import { filtersQuery, type Filters, type listMessages } from "@/lib/user/messages";

type Data = Awaited<ReturnType<typeof listMessages>>;

// Shared body of incoming.php and incoming_attachment.php.
export default function IncomingList({
  title,
  attachments,
  f,
  data,
  page,
  change,
}: {
  title: string;
  attachments: boolean;
  f: Filters;
  data: Data;
  page: number;
  change: (form: FormData) => Promise<void>;
}) {
  return (
    <PageShell title={title}>
      <Card>
        <div className="card-body">
          <div className="live-preview">
            <form method="get">
              <div className="row g-3 align-items-center">
                <DateRangeInput value={f.wa_date} />
                <TextFilter name="mobile_no" value={f.mobile_no} placeholder="Mobile No" />
                <SelectFilter
                  name="read_status"
                  value={f.read_status}
                  label="Status"
                  col={2}
                  options={[["-1", "All"], ["1", "Read"], ["2", "Un-Read"]]}
                />
                {!attachments && <TextFilter name="content" value={f.content} placeholder="Content" col={2} />}
                <SearchButton />
              </div>
            </form>
          </div>
        </div>
        <div className="card-body">
          <div className="live-preview">
            <div className="table-responsive table-card">
              <form action={change}>
                <table className="table align-middle table-nowrap table-striped-columns mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>
                        <SelectAll />S. No.
                      </th>
                      <th>Date</th>
                      <th>Sender Name</th>
                      <th>Mobile No</th>
                      <th>Content</th>
                      {attachments && <th></th>}
                    </tr>
                    <tr>
                      <td colSpan={2}>
                        <select name="cstatus" className="form-control edited" defaultValue="">
                          <option value="">Status</option>
                          <option value="1">Read</option>
                          <option value="2">Un-Read</option>
                        </select>
                      </td>
                      <td colSpan={2}>
                        <input type="submit" className="btn btn-success pull-left margin-right-10" value="Change" name="change_status" />
                      </td>
                      <td colSpan={attachments ? 2 : 1}></td>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => {
                      let sms = decodeEntities(r.m_content);
                      if (sms === "" || sms === "File_Attachment") {
                        sms = r.m_msg_type ?? "";
                        if (r.m_msg_template_para) sms += ` : ${r.m_msg_template_para}`;
                      }
                      return (
                        <tr key={String(r.m_id)}>
                          <td>
                            {data.offset + i + 1}
                            <input type="checkbox" className="mids" name="mids" value={String(r.m_id)} />
                          </td>
                          <td>{phpDate("d M H:i:s", r.m_created_on)}</td>
                          <td>{r.m_sender_name}</td>
                          <td>{r.m_mobile_no}</td>
                          <td>{sms}</td>
                          {attachments && (
                            <td>
                              {r.m_msg_type !== "interactive" && r.m_msg_type !== "text" && (
                                <a href={`/view_attachment?id=${r.m_id}`} className="btn btn-sm btn-danger btn-icon btn-icon-sm" target="_blank" title="View">
                                  <i className="ri-eye-line"></i>
                                </a>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    <Pager pages={data.pages} page={page} colSpan={6} query={filtersQuery(f)} />
                  </tbody>
                </table>
              </form>
            </div>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

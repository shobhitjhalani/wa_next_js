import { ConfirmSubmit, SelectAll } from "./ConfirmSubmit";
import Pager from "./Pager";
import { messagePreview, phpDate, phpJsonDecode, WA_STATUS } from "@/lib/user/format";
import type { listMessages } from "@/lib/user/messages";

type Data = Awaited<ReturnType<typeof listMessages>>;
type Row = Data["rows"][number];
type Kind = "que" | "reports" | "failed" | "error";

/** Badge text of reports.php / reports_error.php for a sent message. */
function sentStatus(r: Row) {
  if (r.m_status !== 3) return <>{WA_STATUS[r.m_status]}</>;
  if (!r.m_message_id) {
    const err = phpJsonDecode<{ error?: { message?: string } }[]>(r.m_status_response);
    return <span className="badge bg-danger">{err?.[0]?.error?.message || "Access Key Error"}</span>;
  }
  return <>{r.m_delivery_status || "Send"}</>;
}

/** Per-row resend button (send_wa.php). `p` tells it where to return. */
// The button points at a separate form (HTML `form` attribute) so it also works inside
// the bulk "Change" form of the failed/error pages without nesting forms.
function SendButton({ id }: { id: bigint }) {
  return (
    <ConfirmSubmit className="btn btn-sm btn-danger btn-icon btn-icon-sm" title="Send" form={`send-${id}`}>
      <i className="ri-send-plane-2-fill fs-17 lh-1 align-middle"></i>
    </ConfirmSubmit>
  );
}

function SendForm({ id, p }: { id: bigint; p: string }) {
  return (
    <form id={`send-${id}`} action="/send_wa" method="post" className="d-none">
      <input type="hidden" name="id" value={String(id)} />
      <input type="hidden" name="p" value={p} />
    </form>
  );
}

export default function MessageReport({
  kind,
  data,
  page,
  query,
  changeAction,
}: {
  kind: Kind;
  data: Data;
  page: number;
  query: Record<string, string>;
  changeAction?: (form: FormData) => Promise<void>;
}) {
  const selectable = kind === "failed" || kind === "error";
  const cols = kind === "failed" ? 7 : 6;
  const p = kind === "reports" ? "a" : kind === "failed" ? "f" : "q";
  // Resend button: always on the failed page, for queued / re-send rows on que and reports.
  const canSend = (r: Row) =>
    kind === "failed" || ((kind === "que" || kind === "reports") && (r.m_status === 1 || r.m_status === 8));

  const table = (
    <table className="table align-middle table-nowrap table-striped-columns mb-0">
      <thead className="table-light">
        <tr>
          <th>
            {selectable && <SelectAll />}S. No.
          </th>
          <th>Date</th>
          <th>Mobile No</th>
          <th>Content</th>
          <th>Updated On</th>
          <th>Status</th>
          {kind === "failed" && <th>Reason</th>}
        </tr>
        {selectable && (
          <tr>
            <td colSpan={4}>
              <select name="cstatus" className="form-control edited" defaultValue="">
                <option value="">Status</option>
                <option value="1">Delete</option>
                <option value="2">Resend</option>
              </select>
            </td>
            <td>
              <input type="submit" className="btn btn-success pull-left margin-right-10" value="Change" name="change_status" />
            </td>
            <td colSpan={2}></td>
          </tr>
        )}
      </thead>
      <tbody>
        {data.rows.map((r, i) => {
          const media = (kind === "que" ? r.m_image : r.m_response_file_name)?.split(",").filter(Boolean) ?? [];
          return (
            <tr key={String(r.m_id)}>
              <td>
                {selectable && <input type="checkbox" className="mids" name="mids" value={String(r.m_id)} />}
                {data.offset + i + 1}
              </td>
              <td>{phpDate("d M H:i:s", r.m_created_on)}</td>
              <td>{r.m_mobile_no}</td>
              <td>
                {messagePreview(r.m_content, r.m_msg_template_name, r.m_msg_template_para).slice(0, 100)}
                {media.map((m) => (
                  <span key={m}>
                    <br />
                    {m}
                  </span>
                ))}
              </td>
              <td>
                {r.m_updated_on > 0 && (
                  <>
                    <br />
                    {phpDate("d-M-Y H:i:s", r.m_updated_on)}
                  </>
                )}
              </td>
              <td>
                <span className="badge bg-info">
                  {kind === "que" ? WA_STATUS[r.m_status] : kind === "failed" ? r.m_delivery_status : sentStatus(r)}
                </span>{" "}
                {canSend(r) && <SendButton id={r.m_id} />}
              </td>
              {kind === "failed" && (
                <td>
                  <span className="badge bg-danger">{r.m_status_response}</span>
                </td>
              )}
            </tr>
          );
        })}
        <Pager pages={data.pages} page={page} colSpan={cols} query={query} />
      </tbody>
    </table>
  );

  return (
    <div className="card-body">
      <div className="live-preview">
        <div className="table-responsive table-card">
          {selectable && changeAction ? <form action={changeAction}>{table}</form> : table}
          {data.rows.filter(canSend).map((r) => (
            <SendForm key={String(r.m_id)} id={r.m_id} p={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

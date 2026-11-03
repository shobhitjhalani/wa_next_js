import { countsAsSent, type UserSummaryRow } from "@/lib/admin/stats";
import { numberFormat, phpDate, ucfirst } from "@/lib/admin/format";

/** Per-user status table used by the dashboard ("Today Summary") and reports/summary. */
export default function SummaryTable({ headings, rows, showLastSend = true }: { headings: string[]; rows: UserSummaryRow[]; showLastSend?: boolean }) {
  const grand: Record<string, number> = {};
  let grandTotal = 0;
  return (
    <div className="table-responsive">
      <table className="table align-middle table-nowrap table-striped-columns mb-0">
        <thead className="table-light">
          <tr>
            <th>S. No.</th>
            <th>UserName</th>
            {headings.map((h) => (
              <th key={h}>{h === "" ? "Not Send" : ucfirst(h)}</th>
            ))}
            <th>Total Send</th>
            {showLastSend && <th>Last WA Send</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            let total = 0;
            return (
              <tr key={r.userId}>
                <td>{i + 1}</td>
                <td>
                  <a href={`/wamaster/view/user/view?ut=2&id=${r.userId}`}>{r.username}</a>
                </td>
                {headings.map((h) => {
                  const n = r.counts[h];
                  if (n !== undefined) {
                    grand[h] = (grand[h] ?? 0) + n;
                    if (countsAsSent(h)) {
                      total += n;
                      grandTotal += n;
                    }
                  }
                  return <td key={h}>{n !== undefined ? numberFormat(n) : ""}</td>;
                })}
                <td>{numberFormat(total)}</td>
                {showLastSend && <td>{phpDate("d-m-Y H:i:s", r.lastSend)}</td>}
              </tr>
            );
          })}
          <tr className="fw-bold">
            <td colSpan={2}>Total</td>
            {headings.map((h) => (
              <td key={h}>{grand[h] !== undefined ? numberFormat(grand[h]) : ""}</td>
            ))}
            <td>{numberFormat(grandTotal)}</td>
            {showLastSend && <td></td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

import { DateRangeInput, SearchButton, SelectFilter, TextFilter } from "@/components/user/Filters";
import PageShell, { Card } from "@/components/user/PageShell";
import { config } from "@/lib/config";
import { currentUser } from "@/lib/user/current";
import { startOfTodayIst, WA_DELIVERY_STATUS } from "@/lib/user/format";
import { readFilters, templateSummary, userTemplateNames } from "@/lib/user/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// reports_templates.php
export default async function ReportsTemplatesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "reports");
  f.del_status = typeof sp.status === "string" ? sp.status : "";
  const [summary, templates] = await Promise.all([
    templateSummary(user.u_id, f, startOfTodayIst() - config.wa.queTime),
    userTemplateNames(user.u_id),
  ]);
  const totals: Record<string, number> = {};
  let grand = 0;
  return (
    <PageShell title="WA Templates Reports">
      <Card>
        <div className="card-body">
          <div className="live-preview">
            <form method="get">
              <div className="row g-3 align-items-center">
                <DateRangeInput value={f.wa_date} />
                <SelectFilter
                  name="template"
                  value={f.template}
                  label="Template"
                  options={[["", "Select Template"], ...templates.map((t): [string, string] => [t.ut_name, t.ut_name])]}
                />
                <SelectFilter name="status" value={f.del_status} label="Status" col={2}
                  options={[["", "Status"], ...Object.entries(WA_DELIVERY_STATUS)]} />
                <TextFilter name="mobile_no" value={f.mobile_no} placeholder="Mobile No" col={2} />
                <SearchButton />
              </div>
            </form>
          </div>
        </div>
        <div className="card-body">
          <div className="live-preview">
            <div className="table-responsive table-card">
              <table className="table align-middle table-nowrap table-striped-columns mb-0">
                <thead className="table-light">
                  <tr>
                    <th>S. No.</th>
                    <th>Template Name</th>
                    {summary.headings.map((h) => (
                      <th key={h} style={{ textAlign: "right" }}>{h === "" ? "sent" : ucfirst(h)}</th>
                    ))}
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map(([name, v], i) => {
                    let rowTotal = 0;
                    return (
                      <tr key={name}>
                        <td>{i + 1}</td>
                        <td>{name}</td>
                        {summary.headings.map((h) => {
                          const n = v[h] ?? 0;
                          rowTotal += n;
                          totals[h] = (totals[h] ?? 0) + n;
                          return <td key={h} style={{ textAlign: "right" }}>{n}</td>;
                        })}
                        <th style={{ textAlign: "right" }}>{(grand += rowTotal, rowTotal)}</th>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Total</th>
                    {summary.headings.map((h) => (
                      <th key={h} style={{ textAlign: "right" }}>{totals[h] ?? ""}</th>
                    ))}
                    <th style={{ textAlign: "right" }}>{grand}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

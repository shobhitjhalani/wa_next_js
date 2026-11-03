import PageShell, { Card } from "@/components/user/PageShell";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/user/current";
import { phpDate } from "@/lib/user/format";
import { rechargeHistory } from "@/lib/user/payments";

// recharge.php ("Recharge History"). The PHP page listed queued *messages* under
// recharge headings (an unfinished copy of que.php); this lists js_user_recharge.
export default async function RechargePage() {
  const user = await currentUser();
  const rows = await rechargeHistory(user.u_id);
  const plans = await db.js_master_value.findMany({
    where: { mv_id: { in: [...new Set(rows.map((r) => BigInt(r.ur_plan_id)))] } },
    select: { mv_id: true, mv_name: true },
  });
  const planName = new Map(plans.map((p) => [Number(p.mv_id), p.mv_name ?? ""]));
  return (
    <PageShell title="Recharge History">
      <Card>
        <div className="card-body">
          <div className="table-responsive table-card">
            <table className="table align-middle table-nowrap table-striped-columns mb-0">
              <thead className="table-light">
                <tr>
                  <th>S. No.</th>
                  <th>Date</th>
                  <th>Invoice No</th>
                  <th>Plan</th>
                  <th>Amount Paid</th>
                  <th>Valid Till</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.ur_id}>
                    <td>{i + 1}</td>
                    <td>{phpDate("d M y H:i", r.ur_created_on)}</td>
                    <td>{r.ur_invoice_no}</td>
                    <td>{planName.get(r.ur_plan_id) ?? ""}</td>
                    <td>{Number(r.ur_received_amount).toFixed(2)}</td>
                    <td>{phpDate("d M Y", r.ur_valid_till)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

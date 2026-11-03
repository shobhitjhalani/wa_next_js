import { redirect } from "next/navigation";
import { ConfirmSubmit } from "@/components/user/ConfirmSubmit";
import PageShell, { Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { createPaymentLog, previousBalance, waPlans } from "@/lib/user/payments";

async function recharge(form: FormData) {
  "use server";
  const user = await currentUser();
  const log = await createPaymentLog(user, Number(form.get("dvalue") ?? 0));
  if (!log) redirect("/wa_plans");
  redirect(`/paycca?pl=${log.id}`);
}

const price = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// wa_plans.php
export default async function WaPlansPage() {
  const user = await currentUser();
  const [plans, balance] = await Promise.all([waPlans(), previousBalance(user.u_parent_id)]);
  return (
    <PageShell title="WA Plans">
      <Card>
        <div className="card-body">
          <div className="row">
            {plans.map((p) => (
              <form key={String(p.mv_id)} action={recharge} className="col-md-12 mb-4">
                <h3 className="card-title align-items-start flex-column">
                  <span className="card-label fw-bold text-gray-800">{p.mv_name}</span>
                </h3>
                <h3>Rs. {price(Number(p.mv_value_decimal))}</h3>
                <div dangerouslySetInnerHTML={{ __html: p.mv_desc ?? "" }} />
                <div className="separator separator-dashed border-primary my-10"></div>
                <input type="hidden" name="dvalue" value={String(p.mv_id)} />
                {balance > 0 ? (
                  <ConfirmSubmit className="btn btn-secondary custom-toggle active"
                    message={`Previous outstanding amount of Rs. ${balance} will be also added.`}>
                    Recharge Now
                  </ConfirmSubmit>
                ) : (
                  <button type="submit" className="btn btn-secondary custom-toggle active">Recharge Now</button>
                )}
              </form>
            ))}
            {plans.length === 0 && <p className="text-muted">No plans available.</p>}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

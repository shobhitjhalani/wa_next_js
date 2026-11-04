import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { listPlans, outstanding } from '@/lib/services/plans';
import { numberFormat } from '@/lib/text';
import { payPlan } from './actions';

export const metadata: Metadata = { title: 'WA Plans' };

/** PHP strip_tags (enough for plan descriptions typed in the admin panel). */
const stripTags = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-zA-Z][^>]*>/g, '');

/** Plans to recharge with (User\PlanController::index, legacy wa_plans.php). */
export default async function PlansPage() {
  const user = await requireUser();
  const [plans, due] = await Promise.all([listPlans(), outstanding(user)]);

  return (
    <>
      <PageTitle title="WA Plans" home="/dashboard" />
      {due > 0 && (
        <div className="alert alert-warning">A previous outstanding amount of Rs. {numberFormat(due, 2)} will be added to your payment.</div>
      )}
      <div className="row">
        {plans.length ? plans.map((plan) => {
          const desc = stripTags(String(plan.mv_desc ?? '')).split(/\r\n|\r|\n/);
          return (
            <div className="col-xl-3 col-md-6" key={plan.mv_id}>
              <div className="card card-height-100">
                <div className="card-body d-flex flex-column">
                  <h5 className="mb-1">{plan.mv_name}</h5>
                  <p className="text-muted mb-3">{parseInt(String(plan.mv_value || '0'), 10) || 0} days validity</p>
                  <h2 className="mb-1">Rs. {numberFormat(plan.mv_value_decimal, 2)}</h2>
                  <p className="text-muted small">+ {config.payment.gstPercent}% GST</p>
                  <div className="text-muted mb-4">
                    {desc.map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}
                  </div>
                  <form action={payPlan.bind(null, plan.mv_id)} className="mt-auto">
                    {due > 0
                      ? <ConfirmButton message={`Previous outstanding amount of Rs. ${due} will be also added.`} className="btn btn-primary w-100">Recharge Now</ConfirmButton>
                      : <button type="submit" className="btn btn-primary w-100">Recharge Now</button>}
                  </form>
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="col-12"><div className="card"><div className="card-body text-muted">No plans are available. Please contact support.</div></div></div>
        )}
      </div>
    </>
  );
}

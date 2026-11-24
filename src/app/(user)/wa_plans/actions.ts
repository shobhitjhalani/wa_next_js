'use server';

import { notFound, redirect } from 'next/navigation';
import { clientIp, requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { plansForUser, startPayment } from '@/lib/services/plans';

/**
 * Start paying for a plan (POST /wa_plans/{plan}) and go to the configured gateway.
 * Only a plan shown to this user: their own custom plans, or the global plans when they have none.
 */
export async function payPlan(planId: number): Promise<void> {
  const user = await requireUser();
  const plan = (await plansForUser(user.u_id)).plans.find((p) => Number(p.mv_id) === planId);
  if (!plan) notFound();
  const log = await startPayment(user, plan, await clientIp());
  redirect(`/payment/${config.payment.gateway === 1 ? 'razorpay' : 'ccavenue'}/${encodeURIComponent(log.p_no)}`);
}

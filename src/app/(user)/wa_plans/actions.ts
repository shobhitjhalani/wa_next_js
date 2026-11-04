'use server';

import { notFound, redirect } from 'next/navigation';
import { clientIp, requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { one } from '@/lib/db';
import { startPayment } from '@/lib/services/plans';
import type { MasterValueRow } from '@/lib/types';

/** Start paying for a plan (POST /wa_plans/{plan}) and go to the configured gateway. */
export async function payPlan(planId: number): Promise<void> {
  const user = await requireUser();
  const plan = await one<MasterValueRow>(
    `SELECT * FROM js_master_value
      WHERE mv_id = $1 AND mv_type = $2 AND mv_dstatus = 0 AND mv_status = 1 AND mv_value_decimal > 0`,
    [planId, config.masters.waPlan],
  );
  if (!plan) notFound();
  const log = await startPayment(user, plan, await clientIp());
  redirect(`/payment/${config.payment.gateway === 1 ? 'razorpay' : 'ccavenue'}/${encodeURIComponent(log.p_no)}`);
}

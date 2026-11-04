import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { one } from '@/lib/db';
import type { PaymentLogRow } from '@/lib/types';
import { razorpayCallback } from './actions';
import { RazorpayCheckout } from './RazorpayCheckout';

export const metadata: Metadata = { title: 'Payment' };

/** Razorpay checkout for a pending payment (User\PlanController::razorpay, legacy payr.php). */
export default async function RazorpayPage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireUser();
  const { no } = await params;
  const log = await one<Pick<PaymentLogRow, 'p_no' | 'p_amount'>>(
    'SELECT p_no, p_amount FROM js_payment_log WHERE p_no = $1 AND p_user_id = $2 AND p_status = 1', [no, user.u_id]);
  if (!log) notFound();

  const options = {
    key: config.payment.razorpayKey,
    amount: Math.round(Number(log.p_amount) * 100),
    currency: 'INR',
    name: config.appName,
    description: log.p_no,
    prefill: { name: user.u_name, email: user.u_email_id, contact: user.u_mobile_no },
    theme: { color: '#405189' },
  };

  return (
    <>
      <PageTitle title="Payment" home="/dashboard" />
      <RazorpayCheckout action={razorpayCallback.bind(null, log.p_no)} options={options} amount={Number(log.p_amount)} no={log.p_no} />
    </>
  );
}

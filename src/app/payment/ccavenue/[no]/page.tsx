import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { ccaEncrypt } from '@/lib/ccavenue';
import { config, url } from '@/lib/config';
import { one } from '@/lib/db';
import type { PaymentLogRow } from '@/lib/types';
import { AutoSubmit } from './AutoSubmit';

export const metadata: Metadata = { title: 'Redirecting to payment…' };

/**
 * Auto-submitting form to CCAvenue (User\PlanController::ccavenue, legacy paycca.php).
 * A bare page like the Blade view, so it lives outside the (user) panel frame.
 */
export default async function CcavenuePage({ params }: { params: Promise<{ no: string }> }) {
  const user = await requireUser();
  const { no } = await params;
  const log = await one<Pick<PaymentLogRow, 'p_no' | 'p_amount'>>(
    'SELECT p_no, p_amount FROM js_payment_log WHERE p_no = $1 AND p_user_id = $2 AND p_status = 1', [no, user.u_id]);
  if (!log) notFound();

  const callback = url('/payment/ccavenue/callback');
  const fields: Record<string, unknown> = {
    merchant_id: config.payment.ccaMerchantId,
    order_id: log.p_no,
    amount: Number(log.p_amount).toFixed(2),
    currency: 'INR',
    redirect_url: callback,
    cancel_url: callback,
    language: 'EN',
    billing_name: user.u_name,
    billing_country: 'India',
    billing_tel: user.u_mobile_no,
    billing_email: user.u_email_id,
  };
  // http_build_query: null values are left out, spaces become "+"
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) qs.append(k, String(v));

  return (
    <div style={{ fontFamily: 'sans-serif', textAlign: 'center', paddingTop: 80 }}>
      <h1>Please do not refresh this page…</h1>
      <AutoSubmit action={config.payment.ccaUrl} encRequest={ccaEncrypt(qs.toString(), config.payment.ccaWorkingKey)} accessCode={config.payment.ccaAccessCode} />
    </div>
  );
}

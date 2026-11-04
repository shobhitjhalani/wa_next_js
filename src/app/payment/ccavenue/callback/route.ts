import { ccaDecode } from '@/lib/ccavenue';
import { config, url } from '@/lib/config';
import { one } from '@/lib/db';
import { completePayment, resultToken } from '@/lib/services/payments';
import type { PaymentLogRow } from '@/lib/types';

/**
 * CCAvenue return / cancel URL (POST /payment/ccavenue/callback, User\PlanController::ccavenueCallback).
 * Posted cross-site without the session cookie, so the payment is found by
 * order number. Records the outcome, then shows /payment/result (303 → GET).
 */
export async function POST(req: Request) {
  let encResp = '';
  try {
    const v = (await req.formData()).get('encResp');
    encResp = typeof v === 'string' ? v : '';
  } catch {
    encResp = '';
  }
  const resp = ccaDecode(encResp, config.payment.ccaWorkingKey);
  const log = await one<PaymentLogRow>('SELECT * FROM js_payment_log WHERE p_no = $1 AND p_status = 1 ORDER BY p_id LIMIT 1', [resp.order_id ?? '']);
  if (!log) return seeOther(url('/payment/result'));

  const ok = (resp.order_status ?? '') === 'Success' && Math.abs(parseFloat(resp.amount ?? '0') - Number(log.p_amount)) < 0.01;
  const out = await completePayment(log, ok, resp.tracking_id ?? '', resp.bank_ref_no ?? '', resp.payment_mode ?? '');
  if (!out.log) return seeOther(url('/payment/result'));
  return seeOther(url(`/payment/result?no=${encodeURIComponent(log.p_no)}&s=${resultToken(log.p_no)}`));
}

const seeOther = (location: string) => new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });

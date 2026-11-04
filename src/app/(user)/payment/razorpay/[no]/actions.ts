'use server';

import { fStr, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { completePayment, PAYMENT_NOT_FOUND, razorpayCapture, razorpayFetchPayment, razorpaySignatureValid } from '@/lib/services/payments';
import { phpDate } from '@/lib/time';
import type { PaymentLogRow } from '@/lib/types';

export interface RazorpayResult {
  ok: boolean;
  message: string;
  validTill: string | null;
  log: { p_no: string; p_amount: number } | null;
}

/**
 * Checkout callback (POST /payment/razorpay/{no}, User\PlanController::razorpayCallback):
 * fetch the payment with the key secret, capture it when only authorized, and
 * require the amount to match. When the checkout returns an order signature
 * it must verify too (HMAC-SHA256 with RAZORPAY_SECRET).
 */
export async function razorpayCallback(no: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const log = await one<PaymentLogRow>('SELECT * FROM js_payment_log WHERE p_no = $1 AND p_user_id = $2 AND p_status = 1', [no, user.u_id]);
  if (!log) return { ok: true, data: { ok: false, message: PAYMENT_NOT_FOUND, validTill: null, log: null } satisfies RazorpayResult };

  const paymentId = fStr(fd, 'razorpay_payment_id');
  const orderId = fStr(fd, 'razorpay_order_id');
  const signature = fStr(fd, 'razorpay_signature');
  let ok = false;
  let method = '';
  try {
    if (signature && !razorpaySignatureValid(orderId, paymentId, signature)) throw new Error('Invalid signature');
    const payment = await razorpayFetchPayment(paymentId);
    const paise = Math.round(Number(log.p_amount) * 100);
    const status = String(payment.status ?? '').toLowerCase();
    if (status === 'authorized' && Number(payment.amount) === paise) {
      await razorpayCapture(paymentId, paise);
      ok = true;
    } else if (status === 'captured' && Number(payment.amount) === paise) {
      ok = true;
    }
    method = payment.method ?? '';
  } catch (e) {
    console.error('Razorpay verification failed', { no, error: (e as Error).message });
    method = '';
  }

  const out = await completePayment(log, ok, paymentId, paymentId, method);
  return {
    ok: true,
    data: { ok: out.ok, message: out.message, validTill: out.validTill ? phpDate('d M Y', out.validTill) : null, log: out.log } satisfies RazorpayResult,
  };
}

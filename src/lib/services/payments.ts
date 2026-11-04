import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { exec, one } from '../db';
import type { MasterValueRow, PaymentLogRow, RechargeRow } from '../types';
import { recharge } from './plans';

/**
 * Gateway-independent end of a plan payment (User\PlanController::complete)
 * plus the Razorpay REST calls the PHP SDK made, and a signed token so the
 * result page can be shown after the cross-site CCAvenue callback.
 */

export interface PaymentOutcome {
  ok: boolean;
  message: string;
  /** Plan validity after the recharge (unix), when one was made. */
  validTill: number | null;
  log: Pick<PaymentLogRow, 'p_no' | 'p_amount'> | null;
}

export const PAYMENT_OK = 'Payment successful. Your plan has been renewed.';
export const PAYMENT_FAILED = 'Payment failed or was cancelled.';
export const PAYMENT_NOT_FOUND = 'Payment not found or already processed.';

/**
 * Mark the payment paid (2) / failed (4) and, when paid, recharge the user.
 * The status change is conditional on the row still being pending, so a
 * repeated gateway callback can't recharge twice.
 */
export async function completePayment(log: PaymentLogRow, ok: boolean, paymentId: string, refNo: string, mode: string): Promise<PaymentOutcome> {
  const changed = await exec(
    `UPDATE js_payment_log SET p_status = $2, p_payment_id = $3, p_reference_no = $4, p_payment_mode = $5
      WHERE p_id = $1 AND p_status = 1`,
    [log.p_id, ok ? 2 : 4, paymentId, refNo, mode],
  );
  if (!changed) return { ok: false, message: PAYMENT_NOT_FOUND, validTill: null, log: null };

  let row: RechargeRow | null = null;
  if (ok) {
    const [plan, user] = await Promise.all([
      one<MasterValueRow>('SELECT * FROM js_master_value WHERE mv_id = $1', [log.p_order_no]),
      one<{ u_id: number }>('SELECT u_id FROM js_user WHERE u_id = $1', [log.p_user_id]),
    ]);
    if (plan && user) {
      row = await recharge(user.u_id, plan, {
        received: Number(log.p_amount),
        source: log.p_gateway,
        paymentLogId: log.p_id,
        refNo,
        status: 1,
        invoice: 1,
      });
    }
  }
  return { ok, message: ok ? PAYMENT_OK : PAYMENT_FAILED, validTill: row?.ur_valid_till ?? null, log: { p_no: log.p_no, p_amount: log.p_amount } };
}

/** Outcome of an already completed payment, for the result page. */
export async function paymentOutcome(no: string): Promise<PaymentOutcome> {
  const log = await one<Pick<PaymentLogRow, 'p_id' | 'p_no' | 'p_amount' | 'p_status'> & { valid_till: number | null }>(
    `SELECT p.p_id, p.p_no, p.p_amount, p.p_status,
            (SELECT r.ur_valid_till FROM js_user_recharge r WHERE r.ur_payment_log_id = p.p_id AND r.ur_payment_log_id > 0 ORDER BY r.ur_id DESC LIMIT 1) AS valid_till
       FROM js_payment_log p WHERE p.p_no = $1 AND p.p_status IN (2, 4) ORDER BY p.p_id DESC LIMIT 1`,
    [no],
  );
  if (!log) return { ok: false, message: PAYMENT_NOT_FOUND, validTill: null, log: null };
  const ok = Number(log.p_status) === 2;
  return { ok, message: ok ? PAYMENT_OK : PAYMENT_FAILED, validTill: ok ? log.valid_till : null, log: { p_no: log.p_no, p_amount: log.p_amount } };
}

// ------------------------------------------------------------------ result link signing

/** HMAC of the payment number so /payment/result can't be used to look up other payments. */
export function resultToken(no: string): string {
  return createHmac('sha256', config.sessionSecret).update('payment-result:' + no).digest('hex').slice(0, 32);
}

export function checkResultToken(no: string, token: string): boolean {
  const expected = Buffer.from(resultToken(no));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ------------------------------------------------------------------ Razorpay (PHP SDK → fetch)

interface RazorpayPayment {
  id: string;
  status: string;
  amount: number;
  method?: string;
}

async function razorpay<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = Buffer.from(`${config.payment.razorpayKey}:${config.payment.razorpaySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/' + path, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${path}: ${res.status} ${body?.error?.description ?? ''}`);
  return body as T;
}

/** $api->payment->fetch($id) */
export const razorpayFetchPayment = (id: string) => razorpay<RazorpayPayment>(`payments/${encodeURIComponent(id)}`);

/** $payment->capture(['amount' => $paise]) */
export const razorpayCapture = (id: string, paise: number) =>
  razorpay<RazorpayPayment>(`payments/${encodeURIComponent(id)}/capture`, { method: 'POST', body: JSON.stringify({ amount: paise, currency: 'INR' }) });

/**
 * Checkout signature: HMAC-SHA256("<order_id>|<payment_id>", key secret)
 * (Razorpay\Api\Utility::verifyPaymentSignature).
 */
export function razorpaySignatureValid(orderId: string, paymentId: string, signature: string): boolean {
  const expected = Buffer.from(createHmac('sha256', config.payment.razorpaySecret).update(`${orderId}|${paymentId}`).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

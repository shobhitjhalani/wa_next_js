'use client';

import { startTransition, useActionState, useRef } from 'react';
import Script from 'next/script';
import { PaymentResult } from '@/components/payment/PaymentResult';
import type { ActionResult } from '@/lib/actions';
import { numberFormat } from '@/lib/text';
import type { RazorpayResult } from './actions';

/** Razorpay checkout (resources/views/user/plans/razorpay.blade.php); shows the result in place. */
export function RazorpayCheckout({ action, options, amount, no }: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  options: Record<string, unknown>;
  amount: number;
  no: string;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  const rzp = useRef<{ open: () => void } | null>(null);

  const init = () => {
    const Razorpay = (window as any).Razorpay;
    if (!Razorpay || rzp.current) return;
    rzp.current = new Razorpay({
      ...options,
      handler: (response: Record<string, string>) => {
        const fd = new FormData();
        for (const k of ['razorpay_payment_id', 'razorpay_order_id', 'razorpay_signature']) if (response[k]) fd.set(k, response[k]);
        startTransition(() => dispatch(fd));
      },
      modal: { ondismiss: () => { window.location.href = '/wa_plans'; } },
    });
    rzp.current!.open();
  };

  const result = state?.data as RazorpayResult | undefined;
  if (result) return <PaymentResult {...result} home="/dashboard" />;

  return (
    <>
      <div className="card">
        <div className="card-body text-center py-5">
          <h4>Please do not refresh this page…</h4>
          <p className="text-muted">Amount payable: Rs. {numberFormat(amount, 2)} ({no})</p>
          <button id="pay" className="btn btn-primary" disabled={pending} onClick={() => (rzp.current ? rzp.current.open() : init())}>Pay Now</button>
        </div>
      </div>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={init} />
    </>
  );
}

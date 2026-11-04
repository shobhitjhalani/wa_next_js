import type { Metadata } from 'next';
import { AuthCard } from '@/components/AuthCard';
import { PaymentResult } from '@/components/payment/PaymentResult';
import { getUser } from '@/lib/auth';
import { sp } from '@/lib/http';
import { checkResultToken, PAYMENT_NOT_FOUND, paymentOutcome, type PaymentOutcome } from '@/lib/services/payments';
import { phpDate } from '@/lib/time';

export const metadata: Metadata = { title: 'Payment Status' };

/**
 * Payment outcome after the CCAvenue callback (user/plans/result.blade.php in
 * the guest layout, as Laravel showed it for the cross-site post). The link
 * is signed by the callback, so only that payment's status can be viewed.
 */
export default async function PaymentResultPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const no = sp(params, 'no');
  const [user, outcome] = await Promise.all([
    getUser(),
    no && checkResultToken(no, sp(params, 's'))
      ? paymentOutcome(no)
      : Promise.resolve<PaymentOutcome>({ ok: false, message: PAYMENT_NOT_FOUND, validTill: null, log: null }),
  ]);

  return (
    <AuthCard tagline="">
      <PaymentResult
        ok={outcome.ok}
        message={outcome.message}
        validTill={outcome.validTill ? phpDate('d M Y', outcome.validTill) : null}
        log={outcome.log}
        home={user ? '/dashboard' : '/'}
      />
    </AuthCard>
  );
}

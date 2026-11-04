import { numberFormat } from '@/lib/text';

/**
 * Outcome card (resources/views/user/plans/result.blade.php). Pure markup, usable from client
 * components; `validTill` is preformatted on the server ("d M Y").
 */
export function PaymentResult({ ok, message, validTill, log, home }: {
  ok: boolean;
  message: string;
  validTill: string | null;
  log: { p_no: string; p_amount: number } | null;
  home: string;
}) {
  return (
    <div className="card">
      <div className="card-body text-center py-5">
        <i className={`${ok ? 'ri-checkbox-circle-line text-success' : 'ri-close-circle-line text-danger'} display-4`} />
        <h4 className="mt-3">{message}</h4>
        {log && <p className="text-muted">Reference: {log.p_no} · Rs. {numberFormat(log.p_amount, 2)}</p>}
        {validTill ? <p>Your plan is valid till <b>{validTill}</b>.</p> : null}
        <a href={home} className="btn btn-primary mt-2">Go to Dashboard</a>
      </div>
    </div>
  );
}

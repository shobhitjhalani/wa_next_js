import PageShell, { Card } from "@/components/user/PageShell";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/user/current";
import { phpDate } from "@/lib/user/format";

type SP = Promise<Record<string, string | string[] | undefined>>;

// success.php — payment result (the CCAvenue callback at /payment/ccavenue redirects here).
export default async function SuccessPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const pl = Number(sp.pl ?? 0);
  const log = pl > 0 ? await db.log_js_payment_log.findFirst({ where: { p_id: pl, p_user_id: user.u_id } }) : null;
  const paid = log?.p_status === 2;
  const fresh = paid ? await db.js_user.findUnique({ where: { u_id: user.u_id }, select: { u_valid_till: true } }) : null;
  return (
    <PageShell title="Payment Status">
      <Card>
        <div className="card-body">
          {paid ? (
            <h4 className="mt-4">
              Your Account is now valid till. <strong>{phpDate("M d,Y", fresh?.u_valid_till ?? 0)}</strong>
            </h4>
          ) : (
            <p>
              Unable to process your order. Please try again. If payment already deducted from your bank please call your
              customer care.
            </p>
          )}
        </div>
      </Card>
    </PageShell>
  );
}

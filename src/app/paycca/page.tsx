import { redirect } from "next/navigation";
import AutoSubmit from "@/components/user/AutoSubmit";
import { config } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { ccaRequest, pendingPayment } from "@/lib/user/payments";

type SP = Promise<Record<string, string | string[] | undefined>>;

// paycca.php: hands the encrypted order to CCAvenue.
export default async function PayCcaPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await requireUser();
  const log = await pendingPayment(user.u_id, Number(sp.pl ?? 0));
  if (!log) redirect("/wa_plans");
  const { encRequest, accessCode } = ccaRequest({ pno: log.p_no, amount: log.p_amount }, user, config.siteUrl);
  return (
    <div className="text-center mt-5">
      <h1>Please do not refresh this page...</h1>
      <AutoSubmit action="https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction"
        fields={{ encRequest, access_code: accessCode }} />
    </div>
  );
}

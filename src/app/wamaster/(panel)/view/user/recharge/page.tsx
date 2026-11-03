import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ActionForm from "@/components/admin/ActionForm";
import RechargeFields from "@/components/admin/RechargeFields";
import { Card, PageTitle } from "@/components/admin/ui";
import { db } from "@/lib/db";
import { getAdmin } from "@/lib/admin/guard";
import { int, type SearchParams } from "@/lib/admin/params";
import { MV_TYPE } from "@/lib/admin/constants";
import { phpDate, todayDmy } from "@/lib/admin/format";
import { companyDetails, findUserFor, masterList, masterName, userTypeName } from "@/lib/admin/users";
import { rechargeAction } from "../actions";

export const dynamic = "force-dynamic";

// wamaster/view/user/recharge.php
export default async function RechargePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const admin = await getAdmin();
  const ut = int(sp, "ut") ?? 2;
  const user = await findUserFor(admin, int(sp, "id") ?? 0, ut);
  if (!user) redirect(`/wamaster/view/user?ut=${ut}`);

  const [title, company, plans, sources] = await Promise.all([
    userTypeName(ut),
    companyDetails(user),
    db.js_master_value.findMany({
      where: { mv_type: MV_TYPE.Plans, mv_dstatus: 0, mv_status: 1, mv_value1: { in: ["2", "3"] } },
      orderBy: [{ mv_value1: "asc" }, { mv_display_order: "asc" }],
      select: { mv_id: true, mv_name: true },
    }),
    masterList(MV_TYPE.PaymentSource),
  ]);
  const state = await masterName(company.state);

  const rows: [string, React.ReactNode][] = [
    ["Name:", user.u_name],
    ["Company Name:", company.company],
    ["Company GSTIN No:", company.gst],
    ["State:", state],
    ["Mobile No:", user.u_mobile_no],
    ["Email:", user.u_email_id],
    ["Username:", user.u_username],
    ["User Status:", user.u_status === 2 ? "Inactive" : "Active"],
    ["WA Valid Till:", phpDate("d-m-Y", user.u_valid_till)],
  ];

  return (
    <AdminShell admin={admin} group="user">
      <PageTitle title={`${title} - Recharge`} />
      <Card>
        <div className="row">
          {rows.map(([label, value]) => (
            <div key={label} className="col-md-3 mb-3">
              <label>
                {label} <br />
                <b>{value}</b>
              </label>
            </div>
          ))}
        </div>
        <ActionForm action={rechargeAction}>
          <input type="hidden" name="user_id" value={user.u_id} />
          <input type="hidden" name="ut" value={ut} />
          <RechargeFields
            plans={plans.map((p) => ({ id: Number(p.mv_id), name: p.mv_name ?? "" }))}
            sources={sources.map((p) => ({ id: Number(p.mv_id), name: p.mv_name ?? "" }))}
            today={todayDmy()}
          />
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-success">
              Recharge
            </button>
            <a href={`/wamaster/view/user?ut=${ut}`} className="btn btn-warning">
              Back
            </a>
          </div>
        </ActionForm>
      </Card>
    </AdminShell>
  );
}

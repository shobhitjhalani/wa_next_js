import FacebookSignup from "@/components/user/FacebookSignup";
import PageShell from "@/components/user/PageShell";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/user/current";
import { phpDate, startOfTodayIst } from "@/lib/user/format";

// dashboard.php. The template/day summaries in the PHP page have their queries
// commented out (they never render), and "Total Msg Send" is always 0 there; both kept as is.
function StatCard({ label, children, icon }: { label: string; children: React.ReactNode; icon: string }) {
  return (
    <div className="col-xl-3 col-md-6">
      <div className="card card-animate">
        <div className="card-body">
          <div className="d-flex align-items-center">
            <div className="flex-grow-1 overflow-hidden">
              <p className="text-uppercase fw-medium text-muted text-truncate mb-0">{label}</p>
            </div>
          </div>
          <div className="d-flex align-items-end justify-content-between mt-4">
            <div>{children}</div>
            <div className="avatar-sm flex-shrink-0">
              <span className="avatar-title bg-primary-subtle rounded fs-3">
                <i className={`bx ${icon} text-primary`}></i>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await currentUser();
  const queDate = startOfTodayIst() - config.wa.queTime;
  const inQue = await db.js_message.count({
    where: { m_is_incoming: 2, m_dstatus: 0, m_status: 1, m_user_id: user.u_id, m_created_on: { gte: queDate } },
  });
  const totalSent = 0;
  const msgLimit = user.u_msg_limit ?? 0;

  return (
    <PageShell title="Dashboard" hideTitle>
      <div className="row">
        <div className="col">
          <div className="h-100">
            <div className="row mb-3 pb-1">
              <div className="col-12">
                <div className="d-flex align-items-lg-center flex-lg-row flex-column">
                  <div className="flex-grow-1">
                    <h4 className="fs-16 mb-1">Hello, {user.u_name}!</h4>
                    <p className="text-muted mb-0">Here&apos;s what&apos;s happening with your account.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="row">
              <StatCard label="WA Status" icon="bxl-whatsapp">
                {!user.u_wa_phone_id ? (
                  <FacebookSignup />
                ) : (
                  <>
                    Phone No.: {user.u_wa_no}
                    <br />
                    <span className={user.u_id === 48 ? "" : "d-none"}>
                      Phone ID.: {user.u_wa_phone_id}
                      <br />
                      WABA ID.: {user.u_wa_b_id}
                      <br />
                      Business ID.: {user.u_business_id}
                      <br />
                    </span>
                  </>
                )}
              </StatCard>

              <StatCard label="Total Msg Send" icon="bx-message-square-dots">
                <h4 className="fs-22 fw-semibold ff-secondary mb-4">{totalSent}</h4>
                <a href="/reports?s=false" className="btn btn-secondary btn-sm">View</a>
              </StatCard>

              {msgLimit > 0 ? (
                <StatCard label="Messages Left" icon="bx-message-square">
                  <h4 className="fs-22 fw-semibold ff-secondary mb-4">{msgLimit - totalSent}</h4>
                </StatCard>
              ) : (
                <StatCard label="In Que" icon="bx-message-square">
                  <h4 className="fs-22 fw-semibold ff-secondary mb-4">{inQue}</h4>
                  <a href="/que?s=false" className="btn btn-secondary btn-sm">View</a>
                </StatCard>
              )}

              <StatCard label="Valid Till" icon="bx-wallet">
                <h4 className="fs-22 fw-semibold ff-secondary mb-4">
                  {user.u_valid_till > 0 ? phpDate("M d, Y", user.u_valid_till) : ""}{" "}
                </h4>
                <a href="/wa_plans?s=false" className="btn btn-info btn-sm">Recharge Now</a>
              </StatCard>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

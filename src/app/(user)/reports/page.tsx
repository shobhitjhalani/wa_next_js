import { DateRangeInput, SearchButton, SelectFilter, TextFilter } from "@/components/user/Filters";
import MessageReport from "@/components/user/MessageReport";
import PageShell, { Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { curPage, WA_DELIVERY_STATUS } from "@/lib/user/format";
import { filtersQuery, listMessages, readFilters } from "@/lib/user/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;

// reports.php — all outgoing messages.
export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "reports");
  const page = curPage(sp);
  const data = await listMessages(user.u_id, "reports", f, page);
  return (
    <PageShell title="WA Reports">
      <Card>
        <div className="card-body">
          <div className="live-preview">
            <form method="get">
              <div className="row g-3 align-items-center">
                <DateRangeInput value={f.wa_date} />
                <TextFilter name="mobile_no" value={f.mobile_no} placeholder="Mobile No" />
                <SelectFilter
                  name="msg_type"
                  value={f.msg_type}
                  label="Template Message"
                  options={[["", "All"], ["1", "Template"], ["2", "Replies"]]}
                />
                <SelectFilter
                  name="del_status"
                  value={f.del_status}
                  label="Delivery Status"
                  options={[["", "All"], ...Object.entries(WA_DELIVERY_STATUS)]}
                />
                <SearchButton />
              </div>
            </form>
          </div>
        </div>
        <MessageReport kind="reports" data={data} page={page} query={filtersQuery(f)} />
      </Card>
    </PageShell>
  );
}

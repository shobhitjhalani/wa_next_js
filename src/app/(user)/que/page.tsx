import { revalidatePath } from "next/cache";
import { ConfirmSubmit } from "@/components/user/ConfirmSubmit";
import { DateRangeInput, SearchButton, TextFilter } from "@/components/user/Filters";
import MessageReport from "@/components/user/MessageReport";
import PageShell, { Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { curPage } from "@/lib/user/format";
import { cancelAllQueued, filtersQuery, listMessages, readFilters } from "@/lib/user/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function cancelAll() {
  "use server";
  const user = await currentUser();
  await cancelAllQueued(user.u_id);
  revalidatePath("/que");
}

// que.php — queued (1) and processing (6) messages.
export default async function QuePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "que");
  const page = curPage(sp);
  const data = await listMessages(user.u_id, "que", f, page);
  return (
    <PageShell title="WA Reports">
      <Card>
        <div className="card-body">
          <div className="live-preview">
            <form method="get">
              <div className="row g-3 align-items-center">
                <DateRangeInput value={f.wa_date} />
                <TextFilter name="mobile_no" value={f.mobile_no} placeholder="Mobile No" />
                <SearchButton />
                <div className="col-2">
                  <ConfirmSubmit className="btn btn-danger" message="Cancel all queued messages?" form="cancel-all">
                    Cancel All
                  </ConfirmSubmit>
                </div>
              </div>
            </form>
            <form id="cancel-all" action={cancelAll} className="d-none"></form>
          </div>
        </div>
        <MessageReport kind="que" data={data} page={page} query={filtersQuery(f)} />
      </Card>
    </PageShell>
  );
}

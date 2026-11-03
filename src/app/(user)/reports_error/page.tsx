import { revalidatePath } from "next/cache";
import { DateRangeInput, SearchButton, TextFilter } from "@/components/user/Filters";
import MessageReport from "@/components/user/MessageReport";
import PageShell, { Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { curPage } from "@/lib/user/format";
import { changeStatus, filtersQuery, listMessages, readFilters } from "@/lib/user/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function change(form: FormData) {
  "use server";
  const user = await currentUser();
  await changeStatus(user.u_id, "error", String(form.get("cstatus") ?? ""), form.getAll("mids").map(String));
  revalidatePath("/reports_error");
}

// reports_error.php — marked sent but Meta returned no message id.
export default async function ReportsErrorPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "error");
  const page = curPage(sp);
  const data = await listMessages(user.u_id, "error", f, page);
  const query = filtersQuery(f);
  return (
    <PageShell title="WA Reports (Error)">
      <Card>
        <div className="card-body">
          <div className="live-preview">
            <form method="get">
              <div className="row g-3 align-items-center">
                <DateRangeInput value={f.wa_date} />
                <TextFilter name="mobile_no" value={f.mobile_no} placeholder="Mobile No" />
                <SearchButton />
                <div className="col-2">
                  <a className="btn btn-info" href={`/export_messages?${new URLSearchParams({ ...query, type: "2" })}`}>
                    Export to Excel
                  </a>
                </div>
              </div>
            </form>
          </div>
        </div>
        <MessageReport kind="error" data={data} page={page} query={query} changeAction={change} />
      </Card>
    </PageShell>
  );
}

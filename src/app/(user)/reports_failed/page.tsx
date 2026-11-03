import { revalidatePath } from "next/cache";
import { DateRangeInput, SearchButton, SelectFilter, TextFilter } from "@/components/user/Filters";
import MessageReport from "@/components/user/MessageReport";
import PageShell, { Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { curPage } from "@/lib/user/format";
import { changeStatus, filtersQuery, listMessages, readFilters, userTemplateNames } from "@/lib/user/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function change(form: FormData) {
  "use server";
  const user = await currentUser();
  await changeStatus(user.u_id, "failed", String(form.get("cstatus") ?? ""), form.getAll("mids").map(String));
  revalidatePath("/reports_failed");
}

// reports_failed.php — messages Meta reported as failed.
export default async function ReportsFailedPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "failed");
  const page = curPage(sp);
  const [data, templates] = await Promise.all([listMessages(user.u_id, "failed", f, page), userTemplateNames(user.u_id)]);
  const query = filtersQuery(f);
  return (
    <PageShell title="WA Reports (Failed)">
      <Card>
        <div className="card-body">
          <div className="live-preview">
            <form method="get">
              <div className="row g-3 align-items-center">
                <DateRangeInput value={f.wa_date} />
                <TextFilter name="mobile_no" value={f.mobile_no} placeholder="Mobile No" />
                <SelectFilter
                  name="template"
                  value={f.template}
                  label="Template"
                  options={[["", "Select Template"], ...templates.map((t): [string, string] => [t.ut_name, t.ut_name])]}
                />
                <SearchButton />
                <div className="col-2">
                  <a className="btn btn-info" href={`/export_messages?${new URLSearchParams({ ...query, type: "3" })}`}>
                    Export to Excel
                  </a>
                </div>
              </div>
            </form>
          </div>
        </div>
        <MessageReport kind="failed" data={data} page={page} query={query} changeAction={change} />
      </Card>
    </PageShell>
  );
}

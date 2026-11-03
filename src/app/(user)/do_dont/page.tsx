import { redirect } from "next/navigation";
import DoDontLists from "@/components/user/DoDontLists";
import PageShell, { Alert, Card } from "@/components/user/PageShell";
import { getDoDont, saveDoDont } from "@/lib/user/ai";
import { currentUser } from "@/lib/user/current";
import { decodeEntities } from "@/lib/user/format";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function save(form: FormData) {
  "use server";
  const user = await currentUser();
  const msg = await saveDoDont(user.u_id, form.getAll("dos").map(String), form.getAll("dont").map(String));
  redirect(`/do_dont?msg=${encodeURIComponent(msg)}`);
}

// do_dont.php
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const { dos, donts } = await getDoDont(user.u_id);
  return (
    <PageShell title="Do's and Don't">
      <Card>
        <div className="card-body">
          <Alert msg={typeof sp.msg === "string" ? sp.msg : ""} kind="success" />
          <form action={save}>
            <DoDontLists dos={dos.map(decodeEntities)} donts={donts.map(decodeEntities)} />
            <button type="submit" className="btn btn-success">Save</button>
          </form>
        </div>
      </Card>
    </PageShell>
  );
}

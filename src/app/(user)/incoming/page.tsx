import { revalidatePath } from "next/cache";
import IncomingList from "@/components/user/IncomingList";
import { currentUser } from "@/lib/user/current";
import { curPage } from "@/lib/user/format";
import { listMessages, markRead, readFilters } from "@/lib/user/messages";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function change(form: FormData) {
  "use server";
  const user = await currentUser();
  await markRead(user.u_id, String(form.get("cstatus") ?? ""), form.getAll("mids").map(String));
  revalidatePath("/incoming");
}

// incoming.php — messages received from customers (unread by default).
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "incoming");
  const page = curPage(sp);
  const data = await listMessages(user.u_id, "incoming", f, page);
  return <IncomingList title="Incoming Msg" attachments={false} f={f} data={data} page={page} change={change} />;
}

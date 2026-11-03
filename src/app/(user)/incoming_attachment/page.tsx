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
  revalidatePath("/incoming_attachment");
}

// incoming_attachment.php — messages received from customers (unread by default).
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const f = readFilters(sp, "attachments");
  const page = curPage(sp);
  const data = await listMessages(user.u_id, "attachments", f, page);
  return <IncomingList title="Attachements" attachments={true} f={f} data={data} page={page} change={change} />;
}

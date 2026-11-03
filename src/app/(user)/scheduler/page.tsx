import ComposePage from "@/components/user/ComposePage";
import { currentUser } from "@/lib/user/current";
import { queueTemplate } from "@/lib/user/compose";

// scheduler.php — an unlinked copy of compose.php (its form posted nowhere); here it
// queues like compose so the page is at least usable.
async function send(_prev: string, form: FormData) {
  "use server";
  const user = await currentUser();
  return queueTemplate(user.u_id, form);
}

export default async function Page() {
  const user = await currentUser();
  return <ComposePage title="Compose WA" userId={user.u_id} tm={0} mobile="" action={send} />;
}

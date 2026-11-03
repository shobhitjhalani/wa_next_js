import ComposePage from "@/components/user/ComposePage";
import { currentUser } from "@/lib/user/current";

type SP = Promise<Record<string, string | string[] | undefined>>;

// create.php ("Create New Carousel Template", linked for user 48 only). The PHP page
// submits to fun_create_template(), which does not exist in the PHP code base (a fatal
// error), so submitting only reports that the feature is not available yet.
async function create() {
  "use server";
  return "Carousel template creation is not available yet.";
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  return <ComposePage title="Create Template" userId={user.u_id} tm={Number(sp.tm ?? 0)} mobile="" action={create} />;
}

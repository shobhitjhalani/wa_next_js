import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AiItems from "@/components/user/AiItems";
import { deleteItem, listItems, saveItem } from "@/lib/user/ai";
import { currentUser } from "@/lib/user/current";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function save(form: FormData) {
  "use server";
  const user = await currentUser();
  const msg = await saveItem("kb", user.u_id, form);
  redirect(`/knowledge_base?msg=${encodeURIComponent(msg)}`);
}

async function remove(form: FormData) {
  "use server";
  const user = await currentUser();
  await deleteItem("kb", user.u_id, Number(form.get("id")));
  revalidatePath("/knowledge_base");
}

// knowledge_base.php
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const items = await listItems("kb", user.u_id);
  const editing = sp.type === "update" ? (items.find((i) => i.id === Number(sp.id)) ?? null) : null;
  return (
    <AiItems title="Knowledge Base" path="/knowledge_base" items={items} editing={editing}
      msg={typeof sp.msg === "string" ? sp.msg : ""} save={save} remove={remove} />
  );
}

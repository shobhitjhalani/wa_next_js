import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AiItems from "@/components/user/AiItems";
import { deleteItem, listItems, saveItem } from "@/lib/user/ai";
import { currentUser } from "@/lib/user/current";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function save(form: FormData) {
  "use server";
  const user = await currentUser();
  const msg = await saveItem("prompt", user.u_id, form);
  redirect(`/prompts?msg=${encodeURIComponent(msg)}`);
}

async function remove(form: FormData) {
  "use server";
  const user = await currentUser();
  await deleteItem("prompt", user.u_id, Number(form.get("id")));
  revalidatePath("/prompts");
}

// prompts.php
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  const items = await listItems("prompt", user.u_id);
  const editing = sp.type === "update" ? (items.find((i) => i.id === Number(sp.id)) ?? null) : null;
  return (
    <AiItems title="Prompts" path="/prompts" items={items} editing={editing}
      msg={typeof sp.msg === "string" ? sp.msg : ""} save={save} remove={remove} />
  );
}

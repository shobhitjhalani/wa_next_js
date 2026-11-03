import ComposePage from "@/components/user/ComposePage";
import { currentUser } from "@/lib/user/current";
import { queueTemplate } from "@/lib/user/compose";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function send(_prev: string, form: FormData) {
  "use server";
  const user = await currentUser();
  return queueTemplate(user.u_id, form);
}

// compose.php — queue a template to a list of numbers (?tm=<template id>, ?mb=<numbers>).
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await currentUser();
  return (
    <ComposePage title="Compose WA" userId={user.u_id} tm={Number(sp.tm ?? 0)}
      mobile={typeof sp.mb === "string" ? sp.mb : ""} action={send} />
  );
}

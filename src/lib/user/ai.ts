import "server-only";
import { db } from "@/lib/db";
import { phpEscape } from "./format";

// Frontend::fun_save_knowledge_base / fun_save_prompts / fun_save_do_dont, scoped to the user.

export type AiItem = { id: number; title: string; keywords: string; content: string; updated: Date | null };

export async function listItems(kind: "kb" | "prompt", userId: number): Promise<AiItem[]> {
  if (kind === "kb") {
    const rows = await db.js_ai_knowledge_base.findMany({ where: { kb_user_id: userId, kb_dstatus: 0 }, orderBy: { kb_id: "desc" } });
    return rows.map((r) => ({ id: r.kb_id, title: r.kb_title, keywords: r.kb_keywords, content: r.kb_content ?? "", updated: r.kb_updated_on ?? r.kb_created_on }));
  }
  const rows = await db.js_ai_prompt.findMany({ where: { ai_user_id: userId }, orderBy: { ai_p_id: "desc" } });
  return rows.map((r) => ({ id: r.ai_p_id, title: r.ai_title ?? "", keywords: r.ai_keywords ?? "", content: r.ai_content ?? "", updated: r.ai_updated_on }));
}

export async function saveItem(kind: "kb" | "prompt", userId: number, form: FormData) {
  const id = Number(form.get("kbid") ?? 0);
  const title = phpEscape(String(form.get("title") ?? "")).slice(0, 255);
  const keywords = phpEscape(String(form.get("keywords") ?? "")).slice(0, 255);
  const content = phpEscape(String(form.get("content") ?? ""));
  if (kind === "kb") {
    const data = { kb_title: title, kb_keywords: keywords, kb_content: content, kb_user_id: userId, kb_updated_on: new Date() };
    if (id > 0) await db.js_ai_knowledge_base.updateMany({ where: { kb_id: id, kb_user_id: userId }, data });
    else await db.js_ai_knowledge_base.create({ data });
    return "Knowledge Base Saved";
  }
  const data = { ai_title: title, ai_keywords: keywords, ai_content: content, ai_user_id: userId, ai_updated_on: new Date() };
  if (id > 0) await db.js_ai_prompt.updateMany({ where: { ai_p_id: id, ai_user_id: userId }, data });
  else await db.js_ai_prompt.create({ data });
  return "Prompt Saved";
}

export async function deleteItem(kind: "kb" | "prompt", userId: number, id: number) {
  if (kind === "kb") await db.js_ai_knowledge_base.deleteMany({ where: { kb_id: id, kb_user_id: userId, kb_dstatus: 0 } });
  else await db.js_ai_prompt.deleteMany({ where: { ai_p_id: id, ai_user_id: userId } });
}

export async function getDoDont(userId: number) {
  const rows = await db.js_ai_do_dont.findMany({ where: { ai_user_id: userId }, orderBy: { ai_dd_id: "asc" } });
  return {
    dos: rows.filter((r) => r.ai_dd_type === 1).map((r) => r.ai_content ?? ""),
    donts: rows.filter((r) => r.ai_dd_type === 2).map((r) => r.ai_content ?? ""),
  };
}

/** Replaces the user's lists, like the PHP (delete both types, insert non-empty lines). */
export async function saveDoDont(userId: number, dos: string[], donts: string[]) {
  const rows = [
    ...dos.filter((c) => c.trim()).map((c) => ({ ai_user_id: userId, ai_dd_type: 1, ai_content: phpEscape(c), ai_updated_on: new Date() })),
    ...donts.filter((c) => c.trim()).map((c) => ({ ai_user_id: userId, ai_dd_type: 2, ai_content: phpEscape(c), ai_updated_on: new Date() })),
  ];
  await db.$transaction([
    db.js_ai_do_dont.deleteMany({ where: { ai_user_id: userId, ai_dd_type: { in: [1, 2] } } }),
    db.js_ai_do_dont.createMany({ data: rows }),
  ]);
  return "Prompt Saved";
}

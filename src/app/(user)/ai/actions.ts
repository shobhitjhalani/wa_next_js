'use server';

import { notFound, redirect } from 'next/navigation';
import { fAll, flash, fStr, invalid, type ActionResult } from '@/lib/actions';
import { requireAiUser } from '@/lib/auth';
import { exec, insertMany, tx } from '@/lib/db';

/** AI settings (User\AiController): knowledge base, prompts, do's & don'ts. */

interface EntryData { title: string; keywords: string | null; content: string | null }

/** Validation of AiController::entryData (empty optional fields become null, like Laravel). */
function entryData(fd: FormData): EntryData | ActionResult {
  const title = fStr(fd, 'title');
  const keywords = fStr(fd, 'keywords');
  const content = fStr(fd, 'content');
  const errors: Record<string, string> = {};
  if (!title) errors.title = 'The title field is required.';
  else if (Array.from(title).length > 255) errors.title = 'The title field must not be greater than 255 characters.';
  if (Array.from(keywords).length > 255) errors.keywords = 'The keywords field must not be greater than 255 characters.';
  if (Object.keys(errors).length) return invalid(errors);
  return { title, keywords: keywords || null, content: content || null };
}

const isData = (v: EntryData | ActionResult): v is EntryData => 'title' in v;

// ------------------------------------------------------------------ knowledge base

export async function saveKnowledge(id: number | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireAiUser();
  const data = entryData(fd);
  if (!isData(data)) return data;
  if (id) {
    const n = await exec(
      'UPDATE js_ai_knowledge_base SET kb_title = $3, kb_keywords = $4, kb_content = $5 WHERE kb_id = $1 AND kb_user_id = $2',
      [id, user.u_id, data.title, data.keywords ?? '', data.content],
    );
    if (!n) notFound();
  } else {
    await exec('INSERT INTO js_ai_knowledge_base (kb_user_id, kb_title, kb_keywords, kb_content) VALUES ($1, $2, $3, $4)',
      [user.u_id, data.title, data.keywords ?? '', data.content]);
  }
  await flash('success', 'Knowledge Base Saved');
  redirect('/ai/knowledge_base');
}

export async function deleteKnowledge(id: number): Promise<void> {
  const user = await requireAiUser();
  await exec('DELETE FROM js_ai_knowledge_base WHERE kb_id = $1 AND kb_user_id = $2', [id, user.u_id]);
  await flash('success', 'Deleted');
  redirect('/ai/knowledge_base');
}

// ------------------------------------------------------------------ prompts

export async function savePrompt(id: number | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireAiUser();
  const data = entryData(fd);
  if (!isData(data)) return data;
  if (id) {
    const n = await exec(
      'UPDATE js_ai_prompt SET ai_title = $3, ai_keywords = $4, ai_content = $5 WHERE ai_p_id = $1 AND ai_user_id = $2',
      [id, user.u_id, data.title, data.keywords, data.content],
    );
    if (!n) notFound();
  } else {
    await exec('INSERT INTO js_ai_prompt (ai_user_id, ai_title, ai_keywords, ai_content) VALUES ($1, $2, $3, $4)',
      [user.u_id, data.title, data.keywords, data.content]);
  }
  await flash('success', 'Prompt Saved');
  redirect('/ai/prompts');
}

export async function deletePrompt(id: number): Promise<void> {
  const user = await requireAiUser();
  await exec('DELETE FROM js_ai_prompt WHERE ai_p_id = $1 AND ai_user_id = $2', [id, user.u_id]);
  await flash('success', 'Deleted');
  redirect('/ai/prompts');
}

// ------------------------------------------------------------------ do's & don'ts

/** Replace the user's lists (blank lines dropped). */
export async function saveDoDont(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireAiUser();
  const lists: [number, string, string[]][] = [[1, 'dos', fAll(fd, 'dos[]')], [2, 'donts', fAll(fd, 'donts[]')]];
  const errors: Record<string, string> = {};
  for (const [, key, items] of lists) {
    items.forEach((v, i) => {
      if (Array.from(v).length > 2000) errors[`${key}.${i}`] = `The ${key}.${i} field must not be greater than 2000 characters.`;
    });
  }
  if (Object.keys(errors).length) return invalid(errors);

  const rows = lists.flatMap(([type, , items]) => items.map((v) => v.trim()).filter(Boolean)
    .map((content) => ({ ai_user_id: user.u_id, ai_dd_type: type, ai_content: content })));
  await tx(async (db) => {
    await exec('DELETE FROM js_ai_do_dont WHERE ai_user_id = $1', [user.u_id], db);
    await insertMany('js_ai_do_dont', rows, { db });
  });
  await flash('success', "Do's & Don'ts Saved");
  redirect('/ai/do_dont');
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAiUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { deletePrompt, savePrompt } from '../../actions';
import { Entries, entryId, type Entry } from '../../Entries';

export const metadata: Metadata = { title: 'Prompts' };

const COLUMNS = 'ai_p_id AS id, ai_title AS title, ai_keywords AS keywords, ai_content AS content, ai_updated_on AS updated';

/** AI prompts (User\AiController::prompts, legacy prompts.php). */
export default async function PromptsPage({ params, searchParams }: {
  params: Promise<{ id?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAiUser();
  const id = entryId((await params).id);
  const sp = await searchParams;
  const [items, editing] = await Promise.all([
    query<Entry>(`SELECT ${COLUMNS} FROM js_ai_prompt WHERE ai_user_id = $1 ORDER BY ai_p_id DESC`, [user.u_id]),
    id ? one<Entry>(`SELECT ${COLUMNS} FROM js_ai_prompt WHERE ai_p_id = $1 AND ai_user_id = $2`, [id, user.u_id]) : null,
  ]);
  if (id && !editing) notFound();

  return (
    <Entries
      title="Prompts"
      path="/ai/prompts"
      items={items}
      editing={editing}
      showForm={!!id || sp.add !== undefined}
      save={savePrompt.bind(null, id)}
      remove={deletePrompt}
    />
  );
}

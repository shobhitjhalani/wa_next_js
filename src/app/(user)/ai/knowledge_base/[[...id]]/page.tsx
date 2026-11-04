import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAiUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { deleteKnowledge, saveKnowledge } from '../../actions';
import { Entries, entryId, type Entry } from '../../Entries';

export const metadata: Metadata = { title: 'Knowledge Base' };

const COLUMNS = 'kb_id AS id, kb_title AS title, kb_keywords AS keywords, kb_content AS content, kb_updated_on AS updated';

/** Knowledge base entries (User\AiController::knowledge, legacy knowledge_base.php). */
export default async function KnowledgeBasePage({ params, searchParams }: {
  params: Promise<{ id?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAiUser();
  const id = entryId((await params).id);
  const sp = await searchParams;
  const [items, editing] = await Promise.all([
    query<Entry>(`SELECT ${COLUMNS} FROM js_ai_knowledge_base WHERE kb_user_id = $1 AND kb_dstatus = 0 ORDER BY kb_id DESC`, [user.u_id]),
    id ? one<Entry>(`SELECT ${COLUMNS} FROM js_ai_knowledge_base WHERE kb_id = $1 AND kb_user_id = $2`, [id, user.u_id]) : null,
  ]);
  if (id && !editing) notFound();

  return (
    <Entries
      title="Knowledge Base"
      path="/ai/knowledge_base"
      items={items}
      editing={editing}
      showForm={!!id || sp.add !== undefined}
      save={saveKnowledge.bind(null, id)}
      remove={deleteKnowledge}
    />
  );
}

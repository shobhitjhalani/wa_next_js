import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { sanitizeGraph, type FlowGraph } from '@/lib/bot-flow';
import { one, query, value } from '@/lib/db';
import { FlowBuilder, type BuilderTemplate } from './FlowBuilder';

export const metadata: Metadata = { title: 'Flow Builder' };

/** Flow Builder: edit a chatbot flow on a canvas. */
export default async function FlowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [flow, templates, running] = await Promise.all([
    one<{ bf_id: number; bf_name: string; bf_status: number; bf_graph: FlowGraph }>(
      'SELECT bf_id, bf_name, bf_status, bf_graph FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]),
    // Approved templates (carousels need per-card media, so they are not offered) with their {{n}} count
    query<BuilderTemplate>(
      `SELECT DISTINCT ON (ut_name) ut_name AS name, COALESCE(ut_language, '') AS language, COALESCE(ut_header_type, '') AS header,
              (SELECT COUNT(DISTINCT m[1])::int FROM regexp_matches(COALESCE(ut_message, ''), '\\{\\{\\s*(\\d+)\\s*\\}\\}', 'g') m) AS params
         FROM js_user_templates
        WHERE ut_user_id = $1 AND ut_dstatus = 0 AND ut_status = 1 AND ut_template_type <> 'carousel'
        ORDER BY ut_name, ut_id DESC`, [user.u_id]),
    value<number>('SELECT COUNT(*)::int FROM js_bot_session WHERE bs_flow_id = $1 AND bs_user_id = $2 AND bs_status = 1', [id, user.u_id]),
  ]);
  if (!flow) notFound();

  return (
    <FlowBuilder
      id={flow.bf_id}
      initialName={flow.bf_name}
      initialStatus={Number(flow.bf_status)}
      initialGraph={sanitizeGraph(flow.bf_graph)}
      templates={templates}
      running={running ?? 0}
    />
  );
}

'use server';

import { notFound, redirect } from 'next/navigation';
import { flash, type ActionResult } from '@/lib/actions';
import { requireBotUser } from '@/lib/auth';
import { FLOW_STATUS, sanitizeGraph, starterGraph, validateGraph, type FlowGraph } from '@/lib/bot-flow';
import { exec, one, value } from '@/lib/db';
import { testFlow, triggerKeywords, type SessionState, type TestInput, type TestMessage } from '@/lib/services/bot-flows';
import { now } from '@/lib/time';

/** Chatbot flows (Flow Builder): create, save from the builder, activate, duplicate, delete. */

export async function createFlow(): Promise<void> {
  const user = await requireBotUser();
  const t = now();
  const count = (await value<number>('SELECT COUNT(*)::int FROM js_bot_flow WHERE bf_user_id = $1', [user.u_id])) ?? 0;
  const id = await value<number>(
    `INSERT INTO js_bot_flow (bf_user_id, bf_name, bf_graph, bf_status, bf_created_on, bf_updated_on)
     VALUES ($1, $2, $3::jsonb, 2, $4, $4) RETURNING bf_id`,
    [user.u_id, `New flow ${count + 1}`, JSON.stringify(starterGraph()), t]);
  redirect(`/bot_flows/${id}`);
}

/** Keywords another active flow of the account already uses. */
async function keywordClash(userId: number, flowId: number, keywords: string[]): Promise<string | null> {
  const row = await one<{ bf_name: string; k: string }>(
    `SELECT bf_name, k FROM js_bot_flow, unnest(bf_keywords) k
      WHERE bf_user_id = $1 AND bf_id <> $2 AND bf_status = 1 AND k = ANY($3::text[]) LIMIT 1`, [userId, flowId, keywords]);
  return row ? `The keyword “${row.k}” is already used by the active flow “${row.bf_name}”.` : null;
}

/** Problems that stop a flow from being activated, with keyword clashes first. */
async function activationProblems(userId: number, id: number, graph: FlowGraph): Promise<string[]> {
  const problems = validateGraph(graph);
  const clash = await keywordClash(userId, id, triggerKeywords(graph).keywords);
  if (clash) problems.unshift(clash);
  return problems;
}

/** Status a flow keeps when it is saved without activating: Paused once it has been active, else Draft. */
async function offStatus(userId: number, id: number): Promise<number> {
  const current = await value<number>('SELECT bf_status FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, userId]);
  if (current === null) notFound();
  return Number(current) === FLOW_STATUS.DRAFT ? FLOW_STATUS.DRAFT : FLOW_STATUS.PAUSED;
}

/**
 * Save from the builder. `active` publishes the flow (it must be complete); otherwise it is
 * kept as it is — a draft, or paused when it was active before (running conversations stop).
 */
export async function saveFlow(id: number, input: { name: string; graph: unknown; active: boolean }): Promise<ActionResult> {
  const user = await requireBotUser();
  const name = String(input.name ?? '').trim().slice(0, 150);
  if (!name) return { ok: false, error: 'Enter a name for the flow.' };
  const graph: FlowGraph = sanitizeGraph(input.graph);
  const { keywords, match } = triggerKeywords(graph);
  const off = await offStatus(user.u_id, id);

  if (input.active) {
    const problems = await activationProblems(user.u_id, id, graph);
    if (problems.length) {
      // Keep the work, switched off
      await store(user.u_id, id, name, graph, keywords, match, off);
      return { ok: false, error: `Saved as ${off === FLOW_STATUS.PAUSED ? 'paused' : 'a draft'}. Fix these to activate the flow:`, data: { problems, status: off } };
    }
    await store(user.u_id, id, name, graph, keywords, match, FLOW_STATUS.ACTIVE);
    return { ok: true, message: 'Saved — the flow is active.', data: { status: FLOW_STATUS.ACTIVE } };
  }
  await store(user.u_id, id, name, graph, keywords, match, off);
  return { ok: true, message: off === FLOW_STATUS.PAUSED ? 'Saved — the flow is paused.' : 'Saved as a draft.', data: { status: off } };
}

async function store(userId: number, id: number, name: string, graph: FlowGraph, keywords: string[], match: number, status: number) {
  const n = await exec(
    `UPDATE js_bot_flow SET bf_name = $3, bf_graph = $4::jsonb, bf_keywords = $5::text[], bf_match = $6, bf_status = $7, bf_updated_on = $8
      WHERE bf_id = $1 AND bf_user_id = $2`,
    [id, userId, name, JSON.stringify(graph), keywords, match, status, now()]);
  if (!n) notFound();
  if (status !== FLOW_STATUS.ACTIVE) await stopRunning(userId, id);
}

/** A switched-off flow answers nobody: its running conversations stop. */
function stopRunning(userId: number, id: number) {
  return exec('UPDATE js_bot_session SET bs_status = 4, bs_updated_on = $3 WHERE bs_flow_id = $1 AND bs_user_id = $2 AND bs_status = 1', [id, userId, now()]);
}

/** List page: Activate (a draft or paused flow) — it must be complete. */
export async function activateFlow(id: number, back: string): Promise<void> {
  const user = await requireBotUser();
  const flow = await one<{ bf_graph: FlowGraph; bf_name: string }>('SELECT bf_graph, bf_name FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]);
  if (!flow) notFound();
  const problems = await activationProblems(user.u_id, id, sanitizeGraph(flow.bf_graph));
  if (problems.length) {
    await flash('error', `“${flow.bf_name}” can't be activated: ${problems[0]}`);
  } else {
    await exec('UPDATE js_bot_flow SET bf_status = $3, bf_updated_on = $4 WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id, FLOW_STATUS.ACTIVE, now()]);
    await flash('success', `“${flow.bf_name}” is active.`);
  }
  redirect(safeBack(back));
}

/** List page: Pause an active flow — no new conversations, running ones stop. */
export async function pauseFlow(id: number, back: string): Promise<void> {
  const user = await requireBotUser();
  const name = await value<string>(
    'UPDATE js_bot_flow SET bf_status = $3, bf_updated_on = $4 WHERE bf_id = $1 AND bf_user_id = $2 RETURNING bf_name', [id, user.u_id, FLOW_STATUS.PAUSED, now()]);
  if (name === null) notFound();
  const stopped = await stopRunning(user.u_id, id);
  await flash('success', `“${name}” is paused${stopped ? ` and ${stopped} running conversation(s) stopped` : ''}.`);
  redirect(safeBack(back));
}

/** Only back to the flows list (keeps its tab / search / page). */
const safeBack = (back: string) => (/^\/bot_flows(\?[^#\s]*)?$/.test(back) ? back : '/bot_flows');

export async function duplicateFlow(id: number): Promise<void> {
  const user = await requireBotUser();
  const t = now();
  const newId = await value<number>(
    `INSERT INTO js_bot_flow (bf_user_id, bf_name, bf_keywords, bf_match, bf_graph, bf_status, bf_created_on, bf_updated_on)
     SELECT bf_user_id, left(bf_name, 140) || ' (copy)', bf_keywords, bf_match, bf_graph, 2, $3, $3
       FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2 RETURNING bf_id`, [id, user.u_id, t]);
  if (!newId) notFound();
  await flash('success', 'Flow duplicated as a draft.');
  redirect(`/bot_flows/${newId}`);
}

export async function deleteFlow(id: number, back = '/bot_flows'): Promise<void> {
  const user = await requireBotUser();
  await exec(`UPDATE js_bot_session SET bs_status = 4, bs_updated_on = $3 WHERE bs_flow_id = $1 AND bs_user_id = $2 AND bs_status = 1`, [id, user.u_id, now()]);
  await exec('DELETE FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]);
  await flash('success', 'Flow deleted.');
  redirect(safeBack(back));
}

/** Builder: stop all running conversations of a flow (e.g. after changing it). */
export async function stopSessions(id: number): Promise<ActionResult> {
  const user = await requireBotUser();
  const n = await exec(`UPDATE js_bot_session SET bs_status = 4, bs_updated_on = $3 WHERE bs_flow_id = $1 AND bs_user_id = $2 AND bs_status = 1`, [id, user.u_id, now()]);
  return { ok: true, message: `${n} running conversation(s) stopped.` };
}

/**
 * Builder: one step of the test chat on the graph as it is on screen (saved or not).
 * Nothing is sent to WhatsApp or stored; webhooks are called for real.
 */
export async function runTest(id: number, input: {
  name: string; graph: unknown; state: SessionState | null; message: TestInput; customer: { name: string; mobile: string };
}): Promise<{ messages: TestMessage[]; state: SessionState | null }> {
  const user = await requireBotUser();
  if (!(await value<number>('SELECT 1 FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]))) notFound();
  const message: TestInput = {
    text: String(input.message?.text ?? '').slice(0, 1000),
    replyId: input.message?.replyId ? String(input.message.replyId).slice(0, 80) : undefined,
    skipWait: !!input.message?.skipWait,
  };
  const customer = {
    name: String(input.customer?.name ?? '').trim().slice(0, 60) || 'Test Customer',
    mobile: String(input.customer?.mobile ?? '').replace(/\D/g, '').slice(0, 15) || '919999999999',
  };
  // The state comes back from the browser: keep only its known fields
  const st = input.state;
  const state: SessionState | null = st && typeof st === 'object' ? {
    node: st.node ? String(st.node).slice(0, 40) : null,
    waitUntil: Number(st.waitUntil) || 0,
    vars: Object.fromEntries(Object.entries(st.vars && typeof st.vars === 'object' ? st.vars : {}).slice(0, 100).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 1000)])),
    retries: Math.min(10, Math.max(0, Number(st.retries) || 0)),
    status: Number(st.status) || 1,
    name: customer.name,
  } : null;
  return testFlow(user.u_id, String(input.name ?? '').slice(0, 150), sanitizeGraph(input.graph), state, message, customer);
}

// ------------------------------------------------------------------ copy / paste between accounts

const FLOW_CODE_TYPE = 'wa-chatbot-flow';

/** The flow as a code to paste into another account (name, trigger, every step and connection). */
export async function copyFlowCode(id: number): Promise<string> {
  const user = await requireBotUser();
  const flow = await one<{ bf_name: string; bf_graph: FlowGraph }>('SELECT bf_name, bf_graph FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2', [id, user.u_id]);
  if (!flow) notFound();
  return JSON.stringify({ type: FLOW_CODE_TYPE, version: 1, name: flow.bf_name, graph: sanitizeGraph(flow.bf_graph) }, null, 2);
}

/**
 * Paste a copied flow into this account as a draft. Returns the new flow and what to check:
 * templates this account doesn't have, keywords its active flows already use.
 */
export async function pasteFlowCode(code: string): Promise<ActionResult> {
  const user = await requireBotUser();
  const text = String(code ?? '').trim();
  if (!text) return { ok: false, error: 'Paste the copied flow code first.' };
  if (text.length > 1_000_000) return { ok: false, error: 'This flow code is too large.' };
  let parsed: { type?: unknown; name?: unknown; graph?: unknown } | null = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || parsed.type !== FLOW_CODE_TYPE || !parsed.graph) {
    return { ok: false, error: 'This is not a copied chatbot flow. Use “Copy flow” in the other account and paste the whole code.' };
  }
  const graph = sanitizeGraph(parsed.graph);
  if (!graph.nodes.length) return { ok: false, error: 'The copied flow has no steps.' };
  if (!graph.nodes.some((n) => n.type === 'trigger')) {
    graph.nodes.unshift({ id: 'trigger', type: 'trigger', position: { x: -340, y: 0 }, data: { keywords: '', match: 'exact' } });
  }
  const name = (String(parsed.name ?? '').trim() || 'Pasted flow').slice(0, 140);
  const { keywords, match } = triggerKeywords(graph);

  const warnings: string[] = [];
  const wanted = [...new Set(graph.nodes.filter((n) => n.type === 'template').map((n) => (n.data as { template: string }).template).filter(Boolean))];
  if (wanted.length) {
    const have = new Set((await value<string[]>(
      `SELECT COALESCE(array_agg(DISTINCT ut_name), '{}') FROM js_user_templates WHERE ut_user_id = $1 AND ut_dstatus = 0 AND ut_status = 1 AND ut_name = ANY($2::text[])`,
      [user.u_id, wanted])) ?? []);
    for (const t of wanted) if (!have.has(t)) warnings.push(`Template “${t}” is not an approved template in this account — choose another one in its Send template step.`);
  }
  const clash = await keywordClash(user.u_id, 0, keywords);
  if (clash) warnings.push(`${clash} Change the trigger keywords before activating.`);

  const t = now();
  const id = await value<number>(
    `INSERT INTO js_bot_flow (bf_user_id, bf_name, bf_keywords, bf_match, bf_graph, bf_status, bf_created_on, bf_updated_on)
     VALUES ($1, $2, $3::text[], $4, $5::jsonb, $6, $7, $7) RETURNING bf_id`,
    [user.u_id, name, keywords, match, JSON.stringify(graph), FLOW_STATUS.DRAFT, t]);
  return { ok: true, message: `“${name}” was added as a draft with ${graph.nodes.length - 1} step(s).`, data: { id, warnings } };
}

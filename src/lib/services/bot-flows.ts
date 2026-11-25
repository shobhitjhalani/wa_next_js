import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type pg from 'pg';
import {
  ASSIGNED_VAR, checkAnswer, checkInput, outputs, parseKeywords, parseMap, roundRobinNext,
  type AskData, type AssignData, type ButtonsData, type InputData, type FlowGraph, type FlowNode, type ListData, type MediaData, type MessageData,
  type TemplateData, type TriggerData, type WaitData, type WebhookData,
} from '../bot-flow';
import { exec, one, query, tx, value, type Queryable } from '../db';
import { contactId, recordMessage } from '../models';
import { decodeEntities, jsonParse, limit } from '../text';
import { dayStart, now } from '../time';
import type { MessageRow } from '../types';
import { saveLead } from './crm';
import { insertMessage } from './messages';
import { sendPending } from './sender';

/**
 * Chatbot flow engine. An incoming message either answers the step a running
 * conversation waits on (buttons, list, ask) or starts the active flow whose
 * trigger keyword it matches. Steps then run until the next one that needs the
 * customer or a wait; the messages they create are sent in order afterwards.
 *
 * The step logic writes to a Host: live conversations queue real WhatsApp
 * messages and keep their state in js_bot_session (serialised per contact with
 * an advisory lock); the builder's test chat (testFlow) collects the messages
 * for display and keeps the state in the browser — nothing is sent or stored.
 */

const MAX_STEPS = 40;              // per run: protects against loops in a flow
const MAX_RETRIES = 3;             // invalid answers before the question is given up
const SESSION_TTL = 24 * 3600;     // a conversation waiting this long for a reply expires
const WEBHOOK_TIMEOUT = 10_000;
const MAX_VAR = 1000;              // characters kept per variable

const STATUS = { RUNNING: 1, COMPLETED: 2, EXPIRED: 3, STOPPED: 4 } as const;

interface FlowRow { bf_id: number; bf_name: string; bf_keywords: string[]; bf_match: number; bf_graph: FlowGraph }

/** Where a conversation is; a js_bot_session row (live) or held by the test chat. */
export interface SessionState {
  node: string | null;      // step waiting for a reply / the wait step
  waitUntil: number;        // wait step: continue at this time (0 = not waiting on a timer)
  vars: Record<string, string>;
  retries: number;
  status: number;           // STATUS
  name: string | null;
}

/** A message a step sends (js_message columns). */
type Out = Partial<Pick<MessageRow, 'm_msg_type' | 'm_content' | 'm_image' | 'm_buttons' | 'm_carousel' | 'm_msg_template_name' | 'm_msg_template_para'>>;

interface Host {
  send(row: Out): Promise<void>;
  /** Assign to team step: the chosen team member's name, or null when nobody could be assigned. */
  assign(d: AssignData, run: Run): Promise<string | null>;
  /** Test chat only: what happened behind the scenes (saved answers, webhook calls). */
  note(text: string): void;
}

interface Run { host: Host; mobile: string; flow: Pick<FlowRow, 'bf_name' | 'bf_graph'>; s: SessionState }
interface Incoming { text: string; replyId: string | null }

const newState = (name: string | null, text: string): SessionState => ({
  node: null, waitUntil: 0, retries: 0, status: STATUS.RUNNING, name,
  vars: { last_reply: clip(text.trim()), trigger: clip(text.trim()) },
});

// ------------------------------------------------------------------ live: incoming messages

interface SessionRow {
  bs_id: number; bs_flow_id: number; bs_name: string | null; bs_node: string | null;
  bs_wait_until: number; bs_vars: Record<string, string>; bs_retries: number; bs_status: number;
}
const fromRow = (r: SessionRow): SessionState => ({
  node: r.bs_node, waitUntil: Number(r.bs_wait_until), vars: r.bs_vars ?? {}, retries: Number(r.bs_retries), status: Number(r.bs_status), name: r.bs_name,
});

function saveSession(db: pg.PoolClient, id: number, s: SessionState) {
  return exec(
    `UPDATE js_bot_session SET bs_node = $2, bs_wait_until = $3, bs_vars = $4::jsonb, bs_retries = $5, bs_status = $6, bs_name = $7, bs_updated_on = $8 WHERE bs_id = $1`,
    [id, s.node, s.waitUntil, JSON.stringify(s.vars), s.retries, s.status, s.name, now()], db);
}

/** What a run does after its transaction: messages to send (in order), then other work (Leads CRM). */
interface Outbox { ids: number[]; later: (() => Promise<void>)[] }
const newOutbox = (): Outbox => ({ ids: [], later: [] });

/** Host for real conversations: messages go into js_message (status 6) and are sent after the transaction. */
function liveHost(db: pg.PoolClient, userId: number, mobile: string, flowName: string, outbox: Outbox): Host {
  return {
    note: () => {},
    assign: (d, run) => assignLive(db, userId, mobile, flowName, d, run, outbox),
    async send(row) {
      const t = now();
      const message = await insertMessage({
        ...row,
        m_mobile_no: mobile,
        m_contact_id: await contactId(userId, mobile, null, db),
        m_user_id: userId,
        m_is_incoming: 2,
        m_source: 2,
        m_sheet_id: 'Bot_Flow',
        m_title: limit(flowName, 250, ''),
        m_status: 6,
        m_in_process_on: t,
        m_created_date: dayStart(t),
        m_created_on: t,
      }, db);
      await recordMessage(message, db);
      outbox.ids.push(message.m_id);
    },
  };
}

/**
 * Handle an incoming message for chatbot flows. Returns true when a flow took
 * it (the caller then skips other auto-replies).
 */
export async function botIncoming(userId: number, mobile: string, name: string | null, message: Record<string, any>): Promise<boolean> {
  const incoming = readIncoming(message);
  if (!mobile) return false;
  // Only accounts the admin switched Chatbot Flows on for
  if (!(await one('SELECT 1 FROM js_user WHERE u_id = $1 AND u_bot_flow = 1', [userId]))) return false;
  const outbox = newOutbox();
  const handled = await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [userId, 'bot:' + mobile]);
    const row = await one<SessionRow>(
      'SELECT * FROM js_bot_session WHERE bs_user_id = $1 AND bs_mobile = $2 AND bs_status = 1 FOR UPDATE', [userId, mobile], db);
    // Only an active flow carries on a conversation (paused / draft / deleted ones stop it)
    const flow = row ? await one<FlowRow>(
      'SELECT bf_id, bf_name, bf_keywords, bf_match, bf_graph FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2 AND bf_status = 1', [row.bs_flow_id, userId], db) : null;

    const startLive = async (exactOnly: boolean) => {
      const found = await findFlow(db, userId, incoming.text, exactOnly);
      if (!found) return false;
      const t = now();
      if (row) await exec(`UPDATE js_bot_session SET bs_status = ${STATUS.STOPPED}, bs_updated_on = $2 WHERE bs_id = $1`, [row.bs_id, t], db);
      const s = newState(name, incoming.text);
      const id = (await one<{ bs_id: number }>(
        `INSERT INTO js_bot_session (bs_user_id, bs_flow_id, bs_mobile, bs_name, bs_vars, bs_created_on, bs_updated_on)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6) RETURNING bs_id`, [userId, found.bf_id, mobile, name, JSON.stringify(s.vars), t], db))!.bs_id;
      await begin({ host: liveHost(db, userId, mobile, found.bf_name, outbox), mobile, flow: found, s });
      await saveSession(db, id, s);
      return true;
    };

    if (row && flow) {
      const s = fromRow(row);
      if (name) s.name = name;
      // An option of another flow's earlier message: that flow takes over
      if (incoming.replyId && !choiceOf(flow.bf_graph, incoming) && await resumeChoice(db, userId, mobile, name, incoming, row.bs_id, outbox)) return true;
      const run: Run = { host: liveHost(db, userId, mobile, flow.bf_name, outbox), mobile, flow, s };
      const result = await respond(run, incoming, (exactOnly) => startLive(exactOnly));
      if (result === 'restarted') return true;
      if (result !== 'idle') {
        await saveSession(db, row.bs_id, s);
        return true;
      }
    } else if (row) {
      await exec(`UPDATE js_bot_session SET bs_status = ${STATUS.STOPPED}, bs_updated_on = $2 WHERE bs_id = $1`, [row.bs_id, now()], db);
    }
    if (await resumeChoice(db, userId, mobile, name, incoming, row?.bs_id ?? null, outbox)) return true;
    return startLive(false);
  });
  await sendOutbox(outbox);
  return handled;
}

/**
 * A tap on an option of an earlier conversation's message (finished, or another flow than the
 * running one): that flow continues from the choice in a new conversation that keeps the
 * earlier answers. Only active flows; the conversations of the last 30 days are looked at.
 */
async function resumeChoice(db: pg.PoolClient, userId: number, mobile: string, name: string | null, incoming: Incoming, runningId: number | null, outbox: Outbox): Promise<boolean> {
  const nodeId = /^(.+):\d{1,2}$/.exec(incoming.replyId ?? '')?.[1];
  if (!nodeId) return false;
  const past = await query<{ bs_id: number; bs_name: string | null; bs_vars: Record<string, string> } & FlowRow>(
    `SELECT s.bs_id, s.bs_name, s.bs_vars, f.bf_id, f.bf_name, f.bf_keywords, f.bf_match, f.bf_graph
       FROM js_bot_session s JOIN js_bot_flow f ON f.bf_id = s.bs_flow_id AND f.bf_user_id = s.bs_user_id AND f.bf_status = 1
      WHERE s.bs_user_id = $1 AND s.bs_mobile = $2 AND s.bs_created_on > $3
      ORDER BY s.bs_id DESC LIMIT 20`, [userId, mobile, now() - 30 * 86400], db);
  const hit = past.find((p) => choiceOf(p.bf_graph, incoming));
  if (!hit) return false;
  const t = now();
  if (runningId) await exec(`UPDATE js_bot_session SET bs_status = ${STATUS.STOPPED}, bs_updated_on = $2 WHERE bs_id = $1`, [runningId, t], db);
  const s: SessionState = { ...newState(name ?? hit.bs_name, incoming.text), vars: { ...(hit.bs_vars ?? {}), trigger: hit.bs_vars?.trigger ?? '' } };
  const id = (await one<{ bs_id: number }>(
    `INSERT INTO js_bot_session (bs_user_id, bs_flow_id, bs_mobile, bs_name, bs_vars, bs_created_on, bs_updated_on)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6) RETURNING bs_id`, [userId, hit.bf_id, mobile, s.name, JSON.stringify(s.vars), t], db))!.bs_id;
  await jumpBack({ host: liveHost(db, userId, mobile, hit.bf_name, outbox), mobile, flow: hit, s }, choiceOf(hit.bf_graph, incoming)!, incoming);
  await saveSession(db, id, s);
  return true;
}

/** Worker: continue conversations whose wait is over; expire ones nobody answered. */
export async function resumeBotSessions(log: (m: string) => void = () => {}): Promise<number> {
  const t = now();
  const expired = await exec(
    `UPDATE js_bot_session SET bs_status = ${STATUS.EXPIRED}, bs_updated_on = $1
      WHERE bs_status = 1 AND bs_wait_until = 0 AND bs_updated_on < $2`, [t, t - SESSION_TTL]);
  if (expired) log(`expired ${expired} chatbot conversation(s)`);

  const due = await query<{ bs_id: number; bs_user_id: number; bs_mobile: string }>(
    'SELECT bs_id, bs_user_id, bs_mobile FROM js_bot_session WHERE bs_status = 1 AND bs_wait_until > 0 AND bs_wait_until <= $1 ORDER BY bs_wait_until LIMIT 200', [t]);
  let resumed = 0;
  for (const d of due) {
    const outbox = newOutbox();
    try {
      await tx(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2))', [d.bs_user_id, 'bot:' + d.bs_mobile]);
        const row = await one<SessionRow>('SELECT * FROM js_bot_session WHERE bs_id = $1 AND bs_status = 1 AND bs_wait_until > 0 FOR UPDATE', [d.bs_id], db);
        if (!row) return;
        // The flow must still be active, and Chatbot Flows still on for the account
        const flow = await one<FlowRow>(
          `SELECT f.bf_id, f.bf_name, f.bf_keywords, f.bf_match, f.bf_graph FROM js_bot_flow f JOIN js_user u ON u.u_id = f.bf_user_id AND u.u_bot_flow = 1
            WHERE f.bf_id = $1 AND f.bf_status = 1`, [row.bs_flow_id], db);
        const s = fromRow(row);
        if (!flow) {
          s.status = STATUS.STOPPED;
          s.waitUntil = 0;
        } else {
          await afterWait({ host: liveHost(db, d.bs_user_id, d.bs_mobile, flow.bf_name, outbox), mobile: d.bs_mobile, flow, s });
        }
        await saveSession(db, row.bs_id, s);
      });
      resumed++;
    } catch (e) {
      console.error('[bot] resume failed', d.bs_id, e);
    }
    await sendOutbox(outbox);
  }
  if (resumed) log(`resumed ${resumed} chatbot conversation(s)`);
  return resumed;
}

/** The account's active flow a message starts: exact keyword matches win over "contains"; the newest flow wins a tie. */
function findFlow(db: pg.PoolClient, userId: number, text: string, exactOnly: boolean): Promise<FlowRow | null> {
  const words = text.trim().toLowerCase();
  if (!words) return Promise.resolve(null);
  return one<FlowRow>(
    `SELECT bf_id, bf_name, bf_keywords, bf_match, bf_graph FROM js_bot_flow
      WHERE bf_user_id = $1 AND bf_status = 1
        AND ($2 = ANY(bf_keywords) OR (NOT $3 AND bf_match = 2 AND EXISTS (SELECT 1 FROM unnest(bf_keywords) k WHERE position(k IN $2) > 0)))
      ORDER BY ($2 = ANY(bf_keywords)) DESC, bf_id DESC LIMIT 1`, [userId, words, exactOnly], db);
}

/** Send a run's messages one after another, in the order the flow created them, then run its other work. */
async function sendOutbox(outbox: Outbox): Promise<void> {
  for (const id of outbox.ids) {
    try {
      await sendPending(id);
    } catch (e) {
      console.error('[bot] send failed', id, e);
    }
  }
  for (const task of outbox.later) await task().catch((e) => console.error('[bot] after-run task failed', e));
}

// ------------------------------------------------------------------ assign to team (round robin)

interface Member { um_id: number; um_name: string }

/** Active team members with inbox access (they can open the chat), in id order; only the step's members when it lists some. */
function assignable(userId: number, d: AssignData, db?: Queryable): Promise<Member[]> {
  return query<Member>(
    `SELECT um_id, um_name FROM js_user_member
      WHERE um_user_id = $1 AND um_status = 1 AND COALESCE(um_perms->>'inbox', 'none') <> 'none'
        AND (cardinality($2::int[]) = 0 OR um_id = ANY($2::int[]))
      ORDER BY um_id`, [userId, d.members], db);
}

/** The member the chat is already assigned to, when "keep" is on and they are still active with inbox access. */
async function currentMember(userId: number, contact: number, db: Queryable): Promise<Member | null> {
  if (!contact) return null;
  return one<Member>(
    `SELECT m.um_id, m.um_name FROM js_user_contact_list c
       JOIN js_user_member m ON m.um_id = c.cl_assigned_member AND m.um_user_id = c.cl_user_id
      WHERE c.cl_id = $1 AND c.cl_user_id = $2 AND m.um_status = 1 AND COALESCE(m.um_perms->>'inbox', 'none') <> 'none'`, [contact, userId], db);
}

/**
 * Live Assign to team step: keep the chat's member (if "keep") or take the next member in turn (one
 * pointer per account, locked so parallel conversations never get the same turn), assign the chat
 * in the inbox and, with "crm", add the lead to Leads CRM for the same member after the transaction.
 */
async function assignLive(db: pg.PoolClient, userId: number, mobile: string, flowName: string, d: AssignData, run: Run, outbox: Outbox): Promise<string | null> {
  const contact = await contactId(userId, mobile, null, db);
  let member = d.keep ? await currentMember(userId, contact, db) : null;
  if (!member) {
    const members = await assignable(userId, d, db);
    if (!members.length) return null;
    await exec('INSERT INTO js_bot_round_robin (rr_user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId], db);
    const last = Number(await value<number>('SELECT rr_last_member FROM js_bot_round_robin WHERE rr_user_id = $1 FOR UPDATE', [userId], db)) || 0;
    const id = roundRobinNext(members.map((m) => m.um_id), last);
    member = members.find((m) => m.um_id === id)!;
    await exec('UPDATE js_bot_round_robin SET rr_last_member = $2, rr_updated_on = $3 WHERE rr_user_id = $1', [userId, member.um_id, now()], db);
  }
  // Touch so open inbox tabs pick the change up on their next poll
  if (contact) await exec('UPDATE js_user_contact_list SET cl_assigned_member = $2, cl_updated_on = now() WHERE cl_id = $1', [contact, member.um_id], db);
  if (d.crm) {
    const chosen = member;
    const lead = leadOf(run);
    outbox.later.push(async () => {
      if (!(await value('SELECT 1 FROM js_user WHERE u_id = $1 AND u_crm = 1 AND u_dstatus = 0', [userId]))) return;
      await saveLead(userId, {
        ...lead, mobile, source: 'whatsapp', campaign: flowName, assignedMember: chosen.um_id,
        activity: `Lead from chatbot flow "${flowName}", assigned to ${chosen.um_name}`,
      }, 'chatbot');
    });
  }
  return member.um_name;
}

/** Variables that are not answers of the customer. */
const INTERNAL_VARS = new Set(['last_reply', 'trigger', 'webhook_status', ASSIGNED_VAR]);

/** Lead details from a conversation: the name typed in a User input "Name" step (else the WhatsApp name) and every answer. */
function leadOf(run: Run): { name: string; fields: Record<string, string> } {
  const nameVar = run.flow.bf_graph.nodes.find((n) => n.type === 'input' && (n.data as InputData).field === 'name' && run.s.vars[(n.data as InputData).saveAs]);
  const name = nameVar ? run.s.vars[(nameVar.data as InputData).saveAs] : run.s.name ?? '';
  const fields = Object.fromEntries(Object.entries(run.s.vars).filter(([k, v]) => !INTERNAL_VARS.has(k) && String(v).trim() !== '').slice(0, 40));
  return { name, fields };
}

// ------------------------------------------------------------------ test chat (Flow Builder)

export type TestMessage =
  | { kind: 'customer'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'text'; text: string; media: string | null }
  | { kind: 'buttons'; text: string; media: string | null; footer: string; options: { id: string; title: string }[] }
  | { kind: 'list'; text: string; footer: string; button: string; options: { id: string; title: string; description: string }[] }
  | { kind: 'template'; name: string; text: string; media: string | null; params: string[] };

export interface TestInput { text?: string; replyId?: string; skipWait?: boolean }

/**
 * One step of the builder's test chat: the customer's message (or "skip wait") against the
 * graph on screen. Nothing is sent or stored; the state goes back to the browser. Webhooks
 * are called for real.
 */
export async function testFlow(
  userId: number, flowName: string, graph: FlowGraph, state: SessionState | null, input: TestInput, who: { name: string; mobile: string },
): Promise<{ messages: TestMessage[]; state: SessionState | null }> {
  const messages: TestMessage[] = [];
  const host: Host = {
    note: (text) => messages.push({ kind: 'note', text }),
    send: async (row) => { messages.push(await testMessage(userId, row)); },
    // Shows who is next in turn; nothing is assigned and the turn does not move
    assign: async (d) => {
      const members = await assignable(userId, d);
      if (!members.length) {
        host.note(`Assign to team: no active team member with inbox access${d.members.length ? ' among the chosen members' : ''} — nobody is assigned.`);
        return null;
      }
      const last = Number(await value<number>('SELECT rr_last_member FROM js_bot_round_robin WHERE rr_user_id = $1', [userId])) || 0;
      const id = roundRobinNext(members.map((m) => m.um_id), last);
      const member = members.find((m) => m.um_id === id)!;
      host.note(`Assigned to ${member.um_name} (round robin among ${members.length}).${d.crm ? ' The lead is added to Leads CRM.' : ''} In the test nothing is changed.`);
      return member.um_name;
    },
  };
  const flow = { bf_name: flowName, bf_graph: graph };
  const text = String(input.text ?? '');
  let s = state ? { ...state, vars: { ...state.vars } } : null;
  const startTest = async (exactOnly: boolean) => {
    if (!matchesTrigger(graph, text, exactOnly)) return false;
    if (s) messages.push({ kind: 'note', text: 'Trigger keyword — the flow starts again.' });
    s = newState(who.name, text);
    await begin({ host, mobile: who.mobile, flow, s });
    return true;
  };

  if (input.skipWait) {
    if (s?.status === STATUS.RUNNING && s.waitUntil) await afterWait({ host, mobile: who.mobile, flow, s });
  } else {
    // A finished test conversation still takes taps on earlier options
    const run = s && (s.status === STATUS.RUNNING || choiceOf(graph, { text, replyId: input.replyId ?? null })) ? { host, mobile: who.mobile, flow, s } : null;
    const result = run ? await respond(run, { text, replyId: input.replyId ?? null }, startTest) : 'idle';
    if (result === 'idle' && !(await startTest(false))) {
      const keywords = parseKeywords((graph.nodes.find((n) => n.type === 'trigger')?.data as TriggerData | undefined)?.keywords ?? '');
      messages.push({ kind: 'note', text: keywords.length
        ? `No reply: “${text.trim()}” is not a trigger keyword${s?.status === STATUS.RUNNING && s.waitUntil ? ' (the flow is waiting)' : ''}. Try: ${keywords.slice(0, 5).join(', ')}`
        : 'No reply: add a trigger keyword to the Trigger step first.' });
    }
  }
  if (s && s.status !== STATUS.RUNNING) messages.push({ kind: 'note', text: 'The flow ended.' });
  return { messages, state: s };
}

function matchesTrigger(graph: FlowGraph, text: string, exactOnly: boolean): boolean {
  const d = graph.nodes.find((n) => n.type === 'trigger')?.data as TriggerData | undefined;
  const words = text.trim().toLowerCase();
  const keys = parseKeywords(d?.keywords ?? '');
  if (!words || !keys.length) return false;
  return keys.includes(words) || (!exactOnly && d?.match === 'contains' && keys.some((k) => words.includes(k)));
}

/** How a message a step sends looks in the test chat. */
async function testMessage(userId: number, row: Out): Promise<TestMessage> {
  const media = row.m_image ? String(row.m_image) : null;
  if (row.m_msg_type === 'bot') {
    const i = jsonParse<any>(row.m_carousel ?? '', {});
    if (i.type === 'list') {
      return {
        kind: 'list', text: i.body?.text ?? '', footer: i.footer?.text ?? '', button: i.action?.button ?? 'Choose',
        options: (i.action?.sections?.[0]?.rows ?? []).map((r: any) => ({ id: String(r.id), title: String(r.title ?? ''), description: String(r.description ?? '') })),
      };
    }
    return {
      kind: 'buttons', text: i.body?.text ?? '', media, footer: i.footer?.text ?? '',
      options: (i.action?.buttons ?? []).map((b: any) => ({ id: String(b.reply?.id ?? ''), title: String(b.reply?.title ?? '') })),
    };
  }
  if (row.m_msg_type === 'template') {
    const name = String(row.m_msg_template_name ?? '');
    const params: string[] = jsonParse<{ body?: string[] }>(row.m_msg_template_para ?? '', {}).body ?? [];
    const tpl = name ? await one<{ ut_message: string | null }>(
      'SELECT ut_message FROM js_user_templates WHERE ut_user_id = $1 AND ut_name = $2 ORDER BY ut_status, ut_id DESC LIMIT 1', [userId, name]) : null;
    const body = decodeEntities(tpl?.ut_message ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => params[Number(n) - 1] ?? m);
    return { kind: 'template', name, text: body, media, params };
  }
  return { kind: 'text', text: String(row.m_content ?? ''), media };
}

// ------------------------------------------------------------------ steps (shared by live and test)

/**
 * A reply to a running conversation. "idle" = it isn't waiting for an answer (timer, or nothing):
 * the caller may start a flow. "restarted" = a trigger keyword started a flow over again.
 */
async function respond(run: Run, incoming: Incoming, restart: (exactOnly: boolean) => Promise<boolean>): Promise<'answered' | 'restarted' | 'idle'> {
  const { s, flow } = run;
  const node = s.node ? flow.bf_graph.nodes?.find((n) => n.id === s.node) : null;
  // A tap on a button / list option of an earlier message: the flow goes on from that choice
  const earlier = choiceOf(flow.bf_graph, incoming);
  if (earlier && !(node && !s.waitUntil && earlier.id === node.id)) {
    await jumpBack(run, earlier, incoming);
    return 'answered';
  }
  if (!node || s.waitUntil) return 'idle';
  // A trigger keyword (whole message) restarts, unless it is a tap on one of this step's own buttons
  const tapped = !!incoming.replyId?.startsWith(node.id + ':');
  if (!tapped && await restart(true)) return 'restarted';
  s.vars.last_reply = clip(incoming.text.trim());
  const answered = await answer(run, node, incoming);
  if (answered !== 'unmatched') return 'answered';
  // Not one of the options: a "contains" keyword starts a flow, otherwise ask again
  if (await restart(false)) return 'restarted';
  await reprompt(run, node);
  return 'answered';
}

/** The buttons / list step (in this graph) a tapped option belongs to, when the option still exists. */
function choiceOf(graph: FlowGraph, incoming: Incoming): FlowNode | null {
  const m = /^(.+):(\d{1,2})$/.exec(incoming.replyId ?? '');
  if (!m) return null;
  const node = graph.nodes?.find((n) => n.id === m[1]);
  if (!node || !CHOICE_KINDS.has(node.type)) return null;
  const count = node.type === 'list' ? (node.data as ListData).rows.length : (node.data as ButtonsData).buttons.length;
  return Number(m[2]) < count ? node : null;
}
const CHOICE_KINDS = new Set<string>(['buttons', 'mediabuttons', 'list']);

/** Continue from an earlier step's option (any wait is dropped, a finished conversation runs again). */
async function jumpBack(run: Run, node: FlowNode, incoming: Incoming): Promise<void> {
  Object.assign(run.s, { status: STATUS.RUNNING, node: node.id, waitUntil: 0, retries: 0 });
  run.s.vars.last_reply = clip(incoming.text.trim());
  run.host.note(`“${clip(incoming.text.trim()).slice(0, 60)}” was picked on an earlier message — the flow continues from that choice.`);
  await answer(run, node, incoming);
}

async function begin(run: Run): Promise<void> {
  const trigger = run.flow.bf_graph.nodes?.find((n) => n.type === 'trigger');
  await walk(run, trigger ? next(run.flow.bf_graph, trigger.id, null) : null);
}

async function afterWait(run: Run): Promise<void> {
  const waitNode = run.s.node ?? '';
  run.s.waitUntil = 0;
  await walk(run, next(run.flow.bf_graph, waitNode, null));
}

function next(graph: FlowGraph, nodeId: string, handle: string | null): FlowNode | null {
  const edge = graph.edges?.find((e) => e.source === nodeId && (e.sourceHandle ?? null) === handle);
  return edge ? graph.nodes.find((n) => n.id === edge.target) ?? null : null;
}

/** Run nodes from `node` until one waits (reply / timer) or the flow ends. */
async function walk(run: Run, node: FlowNode | null): Promise<void> {
  const graph = run.flow.bf_graph;
  for (let steps = 0; node && steps < MAX_STEPS; steps++) {
    switch (node.type) {
      case 'trigger':
        node = next(graph, node.id, null);
        continue;
      case 'message':
        await run.host.send({ m_msg_type: 'text', m_content: fill(run, (node.data as MessageData).text) });
        node = next(graph, node.id, null);
        continue;
      case 'media': {
        const d = node.data as MediaData;
        await run.host.send({ m_msg_type: 'text', m_content: fill(run, d.caption), m_image: fill(run, d.url, encodeURI) });
        node = next(graph, node.id, null);
        continue;
      }
      case 'template': {
        const d = node.data as TemplateData;
        await run.host.send({
          m_msg_type: 'template', m_msg_template_name: d.template, m_content: '',
          m_msg_template_para: JSON.stringify({ body: d.params.map((p) => fill(run, p)) }), m_image: d.headerUrl ? fill(run, d.headerUrl, encodeURI) : null,
        });
        node = next(graph, node.id, null);
        continue;
      }
      case 'buttons':
      case 'mediabuttons':
      case 'list':
      case 'ask':
      case 'input':
        await prompt(run, node);
        return pause(run, node.id, 0);
      case 'wait': {
        const d = node.data as WaitData;
        const seconds = d.amount * (d.unit === 'days' ? 86400 : d.unit === 'hours' ? 3600 : 60);
        run.host.note(`Waits ${d.amount} ${d.amount === 1 ? d.unit.replace(/s$/, '') : d.unit} before the next step.`);
        return pause(run, node.id, now() + seconds);
      }
      case 'webhook': {
        const ok = await callWebhook(run, node.data as WebhookData);
        node = next(graph, node.id, ok ? 'ok' : 'fail'); // no "Failed" connection: the flow ends
        continue;
      }
      case 'assign': {
        const who = await run.host.assign(node.data as AssignData, run);
        if (who) save(run, ASSIGNED_VAR, who);
        node = next(graph, node.id, null);
        continue;
      }
      case 'end':
      default:
        node = null;
    }
  }
  finish(run);
}

function pause(run: Run, nodeId: string, waitUntil: number): void {
  Object.assign(run.s, { node: nodeId, waitUntil, retries: 0 });
}

function finish(run: Run): void {
  Object.assign(run.s, { node: null, waitUntil: 0, status: STATUS.COMPLETED });
}

function save(run: Run, name: string, value: string): void {
  run.s.vars[name] = clip(value);
  run.host.note(`Saved {{${name}}} = ${clip(value).slice(0, 120) || '(empty)'}`);
}

/** The message of a step that waits for the customer (buttons, list, question). */
async function prompt(run: Run, node: FlowNode, prefix = ''): Promise<void> {
  if (node.type === 'ask' || node.type === 'input') {
    await run.host.send({ m_msg_type: 'text', m_content: prefix + fill(run, (node.data as AskData | InputData).text) });
    return;
  }
  if (node.type === 'buttons' || node.type === 'mediabuttons') {
    const d = node.data as ButtonsData;
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: limit(prefix + fill(run, d.text), 1024, '') || ' ' },
      action: { buttons: d.buttons.map((title, i) => ({ type: 'reply', reply: { id: `${node.id}:${i}`, title: limit(title, 20, '') } })) },
    };
    const media = d.mediaUrl ? fill(run, d.mediaUrl, encodeURI) : '';
    if (media) {
      const kind = mediaKind(media);
      const filename = kind === 'document' ? fileNameOf(media) : '';
      interactive.header = { type: kind, [kind]: filename ? { link: media, filename } : { link: media } };
    }
    if (d.footer) interactive.footer = { text: limit(fill(run, d.footer), 60, '') };
    await run.host.send({ m_msg_type: 'bot', m_content: prefix + fill(run, d.text), m_image: media || null, m_buttons: buttonList(d.buttons), m_carousel: JSON.stringify(interactive) });
    return;
  }
  const d = node.data as ListData;
  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: limit(prefix + fill(run, d.text), 4096, '') || ' ' },
    action: {
      button: limit(d.buttonLabel || 'Choose', 20, ''),
      sections: [{
        title: limit(d.buttonLabel || 'Options', 24, ''),
        rows: d.rows.map((r, i) => ({ id: `${node.id}:${i}`, title: limit(r.title, 24, ''), ...(r.description ? { description: limit(fill(run, r.description), 72, '') } : {}) })),
      }],
    },
  };
  if (d.footer) interactive.footer = { text: limit(fill(run, d.footer), 60, '') };
  await run.host.send({ m_msg_type: 'bot', m_content: prefix + fill(run, d.text), m_buttons: buttonList(d.rows.map((r) => r.title)), m_carousel: JSON.stringify(interactive) });
}

/** The customer's reply to a waiting step: continue, ask again, or "unmatched" (not one of the options). */
async function answer(run: Run, node: FlowNode, incoming: Incoming): Promise<'continued' | 'retry' | 'unmatched'> {
  const graph = run.flow.bf_graph;
  if (node.type === 'buttons' || node.type === 'mediabuttons' || node.type === 'list') {
    const options = node.type !== 'list' ? (node.data as ButtonsData).buttons : (node.data as ListData).rows.map((r) => r.title);
    let index = -1;
    if (incoming.replyId?.startsWith(node.id + ':')) index = Number(incoming.replyId.slice(node.id.length + 1));
    if (!(index >= 0 && index < options.length)) {
      const t = incoming.text.trim().toLowerCase();
      index = options.findIndex((o) => o.trim().toLowerCase() === t);
      if (index < 0 && /^\d{1,2}$/.test(t)) index = Number(t) - 1 < options.length ? Number(t) - 1 : -1; // "2" picks the second option
    }
    if (index < 0) return 'unmatched';
    const saveAs = (node.data as ButtonsData | ListData).saveAs;
    if (saveAs) save(run, saveAs, options[index]);
    await walk(run, next(graph, node.id, outputs(node)[index]?.id ?? null));
    return 'continued';
  }
  if (node.type === 'ask' || node.type === 'input') {
    const d = node.data as AskData | InputData;
    const answerValue = node.type === 'input' ? checkInput((d as InputData).field, incoming.text) : checkAnswer((d as AskData).validate, incoming.text);
    if (answerValue === null) {
      if (run.s.retries + 1 >= MAX_RETRIES) {
        run.host.note(`${MAX_RETRIES} invalid answers — the question is given up.`);
        finish(run);
        return 'continued';
      }
      await run.host.send({ m_msg_type: 'text', m_content: fill(run, d.error || 'Please send a valid answer.') });
      run.s.retries++;
      return 'retry';
    }
    if (d.saveAs) save(run, d.saveAs, answerValue);
    await walk(run, next(graph, node.id, null));
    return 'continued';
  }
  return 'unmatched';
}

/** Not one of the options: send the buttons / list again (gives up after a few tries). */
async function reprompt(run: Run, node: FlowNode): Promise<void> {
  if (run.s.retries + 1 >= MAX_RETRIES) {
    run.host.note(`${MAX_RETRIES} replies that are not one of the options — the flow stops.`);
    finish(run);
    return;
  }
  await prompt(run, node, 'Please choose one of the options.\n\n');
  run.s.retries++;
}

const buttonList = (titles: string[]) => titles.map((t) => t.replace(/,/g, ' ').trim()).join(',');

function mediaKind(url: string): 'image' | 'video' | 'document' {
  const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1] ?? '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (['mp4', '3gp'].includes(ext)) return 'video';
  return 'document';
}

// ------------------------------------------------------------------ variables

const clip = (v: string) => String(v ?? '').slice(0, MAX_VAR);

function variables(run: Run): Record<string, string> {
  return { name: run.s.name ?? '', mobile: run.mobile, flow_name: run.flow.bf_name, ...run.s.vars };
}

/** Replace {{variable}} with its value (unknown variables become empty). */
function fill(run: Run, text: string, encode: (v: string) => string = (v) => v): string {
  const vars = variables(run);
  return String(text ?? '').replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, name: string) => encode(vars[name.toLowerCase()] ?? ''));
}

// ------------------------------------------------------------------ webhook

/** Call the step's URL with the conversation's variables; map its JSON reply into variables. */
async function callWebhook(run: Run, d: WebhookData): Promise<boolean> {
  const vars = variables(run);
  let status = 0;
  let body = '';
  let error = '';
  let target = d.url;
  try {
    const url = new URL(fill(run, d.url, encodeURIComponent));
    target = url.toString();
    await assertPublicHost(url);
    const headers: Record<string, string> = { 'User-Agent': 'WA-Flow-Webhook/1.0' };
    for (const line of d.headers.split('\n')) {
      const m = /^\s*([A-Za-z0-9-]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (m) headers[m[1]] = fill(run, m[2]);
    }
    let payload: string | undefined;
    if (d.method === 'POST') {
      headers['Content-Type'] ??= 'application/json';
      payload = d.body.trim()
        ? fill(run, d.body, (v) => JSON.stringify(v).slice(1, -1))
        : JSON.stringify({ flow: run.flow.bf_name, mobile: run.mobile, name: vars.name, variables: run.s.vars });
    }
    const res = await fetch(url, { method: d.method, headers, body: payload, redirect: 'error', signal: AbortSignal.timeout(WEBHOOK_TIMEOUT) });
    status = res.status;
    body = (await res.text()).slice(0, 100_000);
  } catch (e) {
    error = (e as Error).message;
    console.warn('[bot] webhook failed', d.url, error);
  }
  const ok = status >= 200 && status < 300;
  run.host.note(`Webhook ${d.method} ${target} → ${status ? `HTTP ${status}` : `failed (${error || 'no response'})`}${ok ? '' : ' — follows “Failed”'}`);
  run.s.vars.webhook_status = String(status);
  if (d.saveAs) save(run, d.saveAs, body);
  let json: unknown = null;
  try { json = JSON.parse(body); } catch { json = null; }
  for (const [name, path] of parseMap(d.map)) {
    const v = pick(json, path);
    save(run, name, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return ok;
}

/** data.items.0.name → value in a parsed JSON reply. */
function pick(json: unknown, path: string): unknown {
  let cur: any = json;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[part];
  }
  return cur;
}

/** Webhooks may only reach public addresses (not this server or its private network). */
async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http(s) URLs');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivate)) throw new Error('Private address not allowed');
}

function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// ------------------------------------------------------------------ incoming

function readIncoming(msg: Record<string, any>): Incoming {
  const type = String(msg.type ?? '');
  if (type === 'interactive') {
    const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
    return { text: String(r?.title ?? ''), replyId: r?.id ? String(r.id) : null };
  }
  if (type === 'button') return { text: String(msg.button?.text ?? ''), replyId: null };
  if (type === 'text') return { text: String(msg.text?.body ?? ''), replyId: null };
  return { text: '', replyId: null };
}

/** For the builder: keywords of a flow, as saved on the flow row. */
export function triggerKeywords(graph: FlowGraph): { keywords: string[]; match: 1 | 2 } {
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  const d = trigger?.data as TriggerData | undefined;
  return { keywords: parseKeywords(d?.keywords ?? ''), match: d?.match === 'contains' ? 2 : 1 };
}

/** Readable file name of a media link for WhatsApp's document header (without the upload's timestamp prefix). */
function fileNameOf(url: string): string {
  const last = url.split(/[?#]/)[0].split('/').pop() ?? '';
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep it encoded */ }
  return name.replace(/^\d{14}-/, '').slice(0, 240);
}

import 'server-only';
import { exec, insert, one, pool, value } from '../db';
import { contactId, recordMessage } from '../models';
import { fromWaId } from '../phone';
import { dayStart, now } from '../time';
import type { MessageRow, UserRow } from '../types';
import { insertMessage, storeIncoming } from './messages';
import { LIMITED_TYPES } from './template-limit';
import { sendPending } from './sender';

/**
 * Meta webhook payloads (port of waapi/webhook.php) and the delivery-status
 * mover (cron/webhook_que.php).
 *
 * Statuses are queued in js_webhook_que (they can arrive before the send
 * request has stored m_message_id) and applied by processStatusQueue().
 *
 * Slow side effects (forwarding to client URLs, catalogue auto-replies) are
 * handed to `defer`, so the route can answer Meta immediately and run them
 * after the response (next/server after()).
 */

export type Defer = (task: () => Promise<unknown>) => void;
const runInline: Defer = (task) => void task().catch((e) => console.error('[webhook] task failed', e));

type HookUser = Pick<UserRow, 'u_id' | 'u_wa_no' | 'u_send_app' | 'u_wa_app_url' | 'u_wa_incoming_url' | 'u_wa_catalogue_url' | 'u_wa_form_url' | 'u_wa_enable_catalogue' | 'u_wa_phone_id'>;

export async function handleWebhook(payload: Record<string, any>, defer: Defer = runInline): Promise<void> {
  const users = new Map<string, HookUser | null>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneId: string | undefined = v.metadata?.phone_number_id;
      if (!phoneId) continue;
      if (!users.has(phoneId)) {
        users.set(phoneId, await one<HookUser>(
          `SELECT u_id, u_wa_no, u_send_app, u_wa_app_url, u_wa_incoming_url, u_wa_catalogue_url, u_wa_form_url, u_wa_enable_catalogue, u_wa_phone_id
             FROM js_user WHERE u_wa_phone_id = $1 AND u_dstatus = 0 ORDER BY u_id LIMIT 1`, [phoneId]));
      }
      const user = users.get(phoneId);
      if (!user) continue;

      if (Number(user.u_send_app) === 1 && user.u_wa_app_url) {
        const target = user.u_wa_app_url;
        defer(() => forward(target, payload));
      }

      for (const status of v.statuses ?? []) await queueStatus(status);

      const contacts = new Map<string, any>((v.contacts ?? []).map((c: any) => [String(c.wa_id), c]));
      for (const msg of v.messages ?? []) {
        await incomingMessage(user, msg, contacts.get(String(msg.from ?? '')) ?? v.contacts?.[0] ?? {}, defer);
      }
    }
  }
}

async function queueStatus(status: Record<string, any>): Promise<void> {
  const error = status.status === 'failed' ? (status.errors?.[0]?.title ?? null) : null;
  await insert('js_webhook_que', {
    value: JSON.stringify({ msg_id: status.id ?? null, msg_status: status.status ?? null, receipt_no: status.recipient_id ?? null, error_reason: status.errors ?? [] }),
    msg_id: status.id ?? null,
    status: status.status ?? null,
    error,
  }, 'id');
}

async function incomingMessage(user: HookUser, msg: Record<string, any>, contact: Record<string, any>, defer: Defer): Promise<void> {
  const waMessageId: string | undefined = msg.id;
  if (!waMessageId) return;
  // Meta retries deliveries
  if (await value('SELECT 1 FROM js_message WHERE m_message_id = $1 AND m_is_incoming = 1 LIMIT 1', [waMessageId])) return;

  const mobile = fromWaId(String(contact.wa_id ?? msg.from ?? ''));
  const type = String(msg.type ?? '');
  let content = '';
  let isOrder = false;
  let isForm = false;
  let formJson: string | null = null;

  switch (type) {
    case 'text': content = msg.text?.body ?? ''; break;
    case 'order': content = 'WA Catalog Order'; isOrder = true; break;
    case 'interactive': {
      const itype = msg.interactive?.type ?? '';
      if (itype === 'nfm_reply') {
        content = 'Form Response';
        formJson = msg.interactive?.nfm_reply?.response_json ?? null;
        isForm = true;
      } else if (itype === 'call_permission_reply') {
        content = msg.interactive?.call_permission_reply?.response === 'accept' ? 'Call Permission Granted' : 'Call Permission Declined';
      } else {
        content = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '';
      }
      break;
    }
    case 'button': content = msg.button?.text ?? ''; break;
    case 'reaction':
    case 'sticker': break;
    default: content = 'File_Attachment';
  }

  const message = await storeIncoming(user, {
    m_message_id: waMessageId,
    m_context_id: typeof msg.context?.id === 'string' ? msg.context.id : null,
    m_sender_name: contact.profile?.name ?? null,
    m_mobile_no: mobile,
    m_msg_type: type,
    m_content: content,
    m_image: msg[type] !== undefined ? JSON.stringify(msg[type]) : null,
    m_is_read: 2,
  });

  const base = { sender_name: message.m_sender_name, sender_no: mobile, message_id: waMessageId, receiver_mobile_no: user.u_wa_no };

  if (user.u_wa_incoming_url) {
    const target = user.u_wa_incoming_url;
    defer(() => forward(target, { ...base, message: content }));
  }

  if (isOrder && user.u_wa_catalogue_url) {
    const target = user.u_wa_catalogue_url;
    let last: Record<string, unknown> = {};
    const posts = (msg.order?.product_items ?? []).map((item: any) => {
      last = { ...base, product: item.product_retailer_id ?? null, product_qty: item.quantity ?? null, product_rate: item.item_price ?? null, product_currency: item.currency ?? null };
      return last;
    });
    defer(async () => { for (const p of posts) await forward(target, p); });
    await logIncoming(user, mobile, last, 'catalogue', target);
  } else if (isForm) {
    let response: unknown = null;
    try { response = JSON.parse(String(formJson)); } catch { response = null; }
    const data = { ...base, response };
    if (user.u_wa_form_url) {
      const target = user.u_wa_form_url;
      defer(() => forward(target, data));
    }
    await logIncoming(user, mobile, data, 'flow', user.u_wa_form_url);
    await storeFlowResponse(user, message, response, formJson, msg.context?.id);
  }

  await catalogueAutoReply(user, mobile, content, defer);
}

/**
 * When catalogue is enabled and the reply text matches a catalogue keyword,
 * answer with the product list (generalises the legacy hard-coded accessory menu).
 */
async function catalogueAutoReply(user: HookUser, mobile: string, content: string, defer: Defer): Promise<void> {
  if (Number(user.u_wa_enable_catalogue) !== 1 || content === '') return;
  if (!(await value('SELECT 1 FROM js_user_catalogue WHERE c_user_id = $1 AND c_keyword = $2 LIMIT 1', [user.u_id, content]))) return;
  const t = now();
  const reply = await insertMessage({
    m_msg_type: 'product_list',
    m_title: content,
    m_mobile_no: mobile,
    m_contact_id: await contactId(user.u_id, mobile),
    m_user_id: user.u_id,
    m_is_incoming: 2,
    m_sheet_id: 'Catalogue_Response',
    m_source: 2,
    m_status: 6,
    m_in_process_on: t,
    m_created_date: dayStart(t),
    m_created_on: t,
  });
  await recordMessage(reply);
  defer(() => sendPending(reply.m_id));
}

/** Keep the submission for the Flow Responses page; the reply's context points at the template that opened the flow. */
async function storeFlowResponse(user: HookUser, message: MessageRow, response: unknown, raw: string | null, contextId: unknown): Promise<void> {
  const template = typeof contextId === 'string' && contextId !== ''
    ? await value<string>('SELECT m_msg_template_name FROM js_message WHERE m_message_id = $1 AND m_is_incoming = 2 LIMIT 1', [contextId])
    : null;
  const answers = response && typeof response === 'object' && !Array.isArray(response) ? response : { _raw: raw ?? '' };
  await exec(
    `INSERT INTO js_flow_responses (fr_user_id, fr_m_id, fr_wa_id, fr_mobile_no, fr_sender_name, fr_template_name, fr_response, fr_created_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (fr_wa_id) WHERE fr_wa_id IS NOT NULL DO NOTHING`,
    [user.u_id, message.m_id, message.m_message_id, message.m_mobile_no, message.m_sender_name, template, JSON.stringify(answers), Number(message.m_created_on) || now()],
  );
}

async function logIncoming(user: HookUser, sender: string, data: unknown, type: string, postUrl: string | null): Promise<void> {
  await insert('js_incoming_log', {
    il_user_id: user.u_id,
    il_type: type,
    il_rec_phone_no: user.u_wa_no,
    il_sender_phone_no: sender,
    il_response: JSON.stringify(data),
    post_url: postUrl,
  }, 'il_id');
}

async function forward(target: string, data: unknown): Promise<void> {
  try {
    await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    console.warn('[webhook] forward failed', target, (e as Error).message);
  }
}

/**
 * Apply queued delivery statuses to messages (cron/webhook_que.php), set-based:
 * per batch, the latest status of each WhatsApp id updates the message log and
 * the message; matched queue rows are deleted, rows still unmatched after 15
 * minutes are parked (moved = 2). Returns [moved, parked].
 */
/**
 * How far a WhatsApp status has progressed. Meta often delivers statuses out of
 * order (a late "delivered" after "read"); a message never moves back to a lower
 * one, so the inbox ticks only go sent → delivered → read (blue).
 */
const statusRank = (col: string) =>
  `CASE ${col} WHEN 'read' THEN 4 WHEN 'played' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 WHEN 'error' THEN 2 WHEN 'sent' THEN 1 ELSE 0 END`;

export async function processStatusQueue(batch = 2000, maxBatches = 50): Promise<[number, number]> {
  let moved = 0;
  let parked = 0;
  let afterId = 0;
  for (let i = 0; i < maxBatches; i++) {
    const client = await pool.connect();
    let r: { moved: number; parked: number; picked: number; last_id: number | null };
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `WITH batch AS (
           SELECT id, msg_id, status, error, "systemTime" FROM js_webhook_que
            WHERE moved = 1 AND msg_id IS NOT NULL AND msg_id <> '' AND id > $2
            ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
         ), latest AS (
           SELECT DISTINCT ON (msg_id) msg_id, status, error, "systemTime" FROM batch ORDER BY msg_id, ${statusRank('status')} DESC, id DESC
         ), found AS (
           SELECT DISTINCT m_message_id AS msg_id FROM js_message WHERE m_message_id IN (SELECT msg_id FROM latest)
         ), logs AS (
           UPDATE js_message_log l SET ml_wa_status = latest.status FROM latest
            WHERE l.ml_wa_id = latest.msg_id AND ${statusRank('latest.status')} >= ${statusRank('l.ml_wa_status')} RETURNING 1
         ), msgs AS (
           -- p is the row before this update (same snapshot), so a change into / out of "failed" is visible.
           -- m_updated_on is when the status was applied, so the open inbox (polling by m_updated_on) sees it.
           UPDATE js_message m SET m_updated_on = EXTRACT(EPOCH FROM now())::int,
                  m_delivery_status = latest.status, m_status_response = latest.error
             FROM latest JOIN js_message p ON p.m_message_id = latest.msg_id
            WHERE m.m_message_id = latest.msg_id AND m.m_id = p.m_id
              AND ${statusRank('latest.status')} >= ${statusRank('p.m_delivery_status')}
           RETURNING latest.msg_id, m.m_user_id, m.m_msg_type,
                     COALESCE(p.m_delivery_status, '') IN ('failed', 'error') AS was_failed,
                     COALESCE(latest.status, '') IN ('failed', 'error') AS is_failed
         ), quota AS (
           -- Failed template messages don't count against the template limit (services/template-limit.ts)
           UPDATE js_user u SET u_msg_used = GREATEST(u.u_msg_used + d.delta, 0)
             FROM (SELECT m_user_id, SUM(CASE WHEN is_failed AND NOT was_failed THEN -1 WHEN was_failed AND NOT is_failed THEN 1 ELSE 0 END)::int AS delta
                     FROM msgs WHERE m_msg_type = ANY($3::text[]) GROUP BY m_user_id) d
            WHERE u.u_id = d.m_user_id AND d.delta <> 0 RETURNING 1
         ), del AS (
           DELETE FROM js_webhook_que q USING batch
            WHERE q.id = batch.id AND batch.msg_id IN (SELECT msg_id FROM found) RETURNING q.id
         ), park AS (
           UPDATE js_webhook_que q SET moved = 2 FROM batch
            WHERE q.id = batch.id AND batch.msg_id NOT IN (SELECT msg_id FROM found)
              AND batch."systemTime" < now() - interval '15 minutes' RETURNING q.id
         )
         SELECT (SELECT COUNT(*) FROM del)::int AS moved, (SELECT COUNT(*) FROM park)::int AS parked,
                (SELECT COUNT(*) FROM batch)::int AS picked, (SELECT MAX(id) FROM batch) AS last_id,
                (SELECT COUNT(*) FROM logs)::int AS logs`,
        [batch, afterId, LIMITED_TYPES],
      );
      await client.query('COMMIT');
      r = res.rows[0];
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    moved += r.moved;
    parked += r.parked;
    // Rows not matched yet stay pending; continue after this batch until the queue is exhausted
    if (r.picked < batch || r.last_id === null) break;
    afterId = r.last_id;
  }
  return [moved, parked];
}

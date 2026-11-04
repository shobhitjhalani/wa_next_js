/**
 * Background jobs — replace the Laravel scheduler commands (and the legacy
 * cron/*.php scripts). Used by worker/index.ts (scheduler) and worker/cli.ts.
 */
import { readdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '@/lib/config';
import { exec, query } from '@/lib/db';
import { messagePreview } from '@/lib/format';
import { limit } from '@/lib/text';
import { addDays, dayStart, now, phpDate } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';
import { dispatchDueCampaigns } from '@/lib/services/campaigns';
import { sendMail } from '@/lib/services/mailer';
import { expirePlans as expireUserPlans } from '@/lib/services/plans';
import { adminReportHtml, userReportHtml } from '@/lib/services/report-mail';
import { adminSummary, userTemplateReport } from '@/lib/services/reports';
import { claimAndSend, inSendWindow, mapLimit } from '@/lib/services/sender';
import { processStatusQueue } from '@/lib/services/webhook';

export type Log = (msg: string) => void;

/** wa:send-queue — claim queued messages per active user and send them (07:00–23:00 unless forced). */
export async function sendQueue(opts: { user?: number; force?: boolean } = {}, log: Log = console.log): Promise<number> {
  if (!opts.force && !inSendWindow()) {
    log('Outside sending window.');
    return 0;
  }
  const queFrom = dayStart() - config.queTime;
  // Only users that actually have queued messages (partial index on the queue)
  const users = await query<{ u_id: number }>(
    `SELECT u.u_id FROM js_user u
      WHERE u.u_dstatus = 0 AND u.u_type = $1 AND u.u_status = 1 AND u.u_wa_plan_status = 1
        AND ($3::int IS NULL OR u.u_id = $3)
        AND EXISTS (SELECT 1 FROM js_message m WHERE m.m_user_id = u.u_id AND m.m_status = 1 AND m.m_is_incoming = 2
                      AND m.m_dstatus = 0 AND m.m_created_on >= $2)
      ORDER BY u.u_id`,
    [USER_TYPE.WHATSAPP, queFrom, opts.user ?? null],
  );
  let sent = 0;
  // Accounts in parallel (each has its own phone number / rate limit), batch per account per run like the legacy cron
  await mapLimit(users, 4, async (u) => {
    try {
      sent += await claimAndSend(u.u_id, queFrom, config.sendBatch);
    } catch (e) {
      console.error('[send-queue] user', u.u_id, e);
    }
  });
  log(`${sent} message(s) processed.`);
  return sent;
}

/** wa:dispatch-campaigns — queue the messages of scheduled campaigns that are due. */
export async function dispatchCampaigns(log: Log = console.log): Promise<void> {
  const [count, messages] = await dispatchDueCampaigns();
  log(`${count} campaign(s) dispatched, ${messages} message(s) queued.`);
}

/** wa:process-webhooks — apply queued delivery statuses. */
export async function processWebhooks(log: Log = console.log): Promise<void> {
  const [moved, parked] = await processStatusQueue();
  log(`${moved} webhook(s) applied, ${parked} parked as not found.`);
}

/** wa:expire-plans — mark expired WhatsApp plans. */
export async function expirePlans(log: Log = console.log): Promise<void> {
  log(`${await expireUserPlans()} user(s) expired.`);
}

/** wa:cleanup — cancel stale queued messages, purge temporary media. */
export async function cleanup(log: Log = console.log): Promise<void> {
  const cancelled = await exec(
    `UPDATE js_message SET m_status = 5, m_updated_on = $2
      WHERE m_is_incoming = 2 AND m_dstatus = 0 AND m_status IN (1, 2) AND m_created_on <= $1`,
    [addDays(now(), -config.cancelAfterDays), now()],
  );
  log(`${cancelled} stale message(s) system-cancelled.`);

  let removed = 0;
  const cutoff = phpDate('ymd', addDays(now(), -1));
  const waMsg = path.join(config.mediaPath, 'wa_msg');
  for (const dir of await readdir(waMsg).catch(() => [] as string[])) {
    if (dir < cutoff) {
      await rm(path.join(waMsg, dir), { recursive: true, force: true });
      removed++;
    }
  }
  const apiCutoff = Date.now() - config.cancelAfterDays * 86400_000;
  for (const f of await readdir(config.apiMediaPath).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(config.apiMediaPath, f);
    const mtime = (await stat(p).catch(() => null))?.mtimeMs ?? Infinity;
    if (mtime < apiCutoff) await unlink(p).catch(() => undefined);
  }
  // Incoming attachments are a download cache; view_attachment fetches them again from Meta
  const att = path.join(config.mediaPath, 'attachment');
  const dayAgo = Date.now() - 86400_000;
  for (const sub of await readdir(att).catch(() => [] as string[])) {
    for (const f of await readdir(path.join(att, sub)).catch(() => [] as string[])) {
      const p = path.join(att, sub, f);
      const st = await stat(p).catch(() => null);
      if (st?.isFile() && st.mtimeMs < dayAgo) await unlink(p).catch(() => undefined);
    }
  }
  log(`${removed} media folder(s) removed.`);
}

/** wa:email-reports — daily summary to the admin, template report to selected clients. */
export async function emailReports(opts: { users?: number[]; adminOnly?: boolean } = {}, log: Log = console.log): Promise<void> {
  const bcc = config.reports.bcc ? [config.reports.bcc] : [];
  let sent = 0;
  if (config.reports.adminEmail) {
    await sendMail({ to: config.reports.adminEmail, bcc, subject: 'WA Business API Report ' + phpDate('M d, Y H:i'), html: adminReportHtml(await adminSummary()) });
    sent++;
  } else {
    log('REPORT_ADMIN_EMAIL is not set; admin summary skipped.');
  }
  if (!opts.adminOnly) {
    const ids = opts.users?.length ? opts.users : config.reports.templateUsers;
    const users = ids.length
      ? await query<{ u_id: number; u_name: string | null; u_email_id: string }>(
        "SELECT u_id, u_name, u_email_id FROM js_user WHERE u_dstatus = 0 AND u_id = ANY($1::int[]) AND COALESCE(u_email_id, '') <> ''", [ids])
      : [];
    for (const u of users) {
      await sendMail({
        to: { name: u.u_name ?? '', address: u.u_email_id },
        bcc,
        subject: `WA Messages Report of ${u.u_name ?? ''} as on ${phpDate('M d, Y')}`,
        html: userReportHtml(await userTemplateReport(u.u_id)),
      });
      sent++;
    }
  }
  log(`${sent} report email(s) sent.`);
}

/**
 * wa:inbox-rebuild — build the inbox conversation index (cl_last_*, cl_unread)
 * from existing messages, set-based per user. Safe to re-run.
 */
export async function inboxRebuild(opts: { user?: number } = {}, log: Log = console.log): Promise<void> {
  const users = await query<{ u_id: number }>('SELECT u_id FROM js_user WHERE ($1::int IS NULL OR u_id = $1) ORDER BY u_id', [opts.user ?? null]);
  for (const { u_id } of users) {
    const started = Date.now();
    const pairs = await query<{ m_mobile_no: string; last_in: number; unread: number; name: string | null }>(
      `SELECT m_mobile_no, MAX(m_created_on)::int AS last_in, COUNT(*) FILTER (WHERE m_is_read = 2)::int AS unread, MAX(m_sender_name) AS name
         FROM js_message WHERE m_user_id = $1 AND m_is_incoming = 1 AND m_dstatus = 0 AND COALESCE(m_mobile_no, '') <> ''
        GROUP BY m_mobile_no`, [u_id]);
    if (!pairs.length) continue;
    const last = await query<{ m_id: number; m_mobile_no: string; m_is_incoming: number; m_msg_type: string | null; m_content: string | null; m_msg_template_name: string | null; m_image: string | null; m_created_on: number }>(
      `SELECT DISTINCT ON (m_mobile_no) m_id, m_mobile_no, m_is_incoming, m_msg_type, m_content, m_msg_template_name, m_image, m_created_on
         FROM js_message WHERE m_user_id = $1 AND m_dstatus = 0 AND m_mobile_no = ANY($2::text[])
        ORDER BY m_mobile_no, m_id DESC`, [u_id, pairs.map((p) => p.m_mobile_no)]);
    const byMobile = new Map(last.map((m) => [m.m_mobile_no, m]));
    const rows = pairs.map((p) => {
      const m = byMobile.get(p.m_mobile_no);
      return {
        mobile: limit(p.m_mobile_no, 15, ''),
        name: p.name ? limit(p.name, 250, '') : null,
        last_msg: phpDate('Y-m-d H:i:s', m?.m_created_on ?? p.last_in),
        last_id: m?.m_id ?? 0,
        preview: m ? limit(messagePreview(m), 250, '…') : null,
        dir: m ? (Number(m.m_is_incoming) === 1 ? 1 : 2) : 1,
        last_in: p.last_in,
        unread: p.unread,
      };
    });
    await exec(
      `INSERT INTO js_user_contact_list (cl_user_id, cl_mobile_no, cl_name, cl_last_msg, cl_last_msg_id, cl_last_preview, cl_last_dir, cl_last_in, cl_unread)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::timestamp[], $5::bigint[], $6::text[], $7::smallint[], $8::int[], $9::int[])
       ON CONFLICT (cl_user_id, cl_mobile_no) DO UPDATE SET
         cl_name = COALESCE(js_user_contact_list.cl_name, EXCLUDED.cl_name), cl_last_msg = EXCLUDED.cl_last_msg,
         cl_last_msg_id = EXCLUDED.cl_last_msg_id, cl_last_preview = EXCLUDED.cl_last_preview, cl_last_dir = EXCLUDED.cl_last_dir,
         cl_last_in = EXCLUDED.cl_last_in, cl_unread = EXCLUDED.cl_unread`,
      [u_id, rows.map((r) => r.mobile), rows.map((r) => r.name), rows.map((r) => r.last_msg), rows.map((r) => r.last_id),
        rows.map((r) => r.preview), rows.map((r) => r.dir), rows.map((r) => r.last_in), rows.map((r) => r.unread)],
    );
    log(`  ✓ user ${u_id}: ${pairs.length.toLocaleString()} conversations (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
}

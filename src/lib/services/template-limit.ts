import 'server-only';
import { exec, one, type Queryable, pool } from '../db';

/**
 * Per-account cap on template messages, set by admins on the user form.
 *
 *   js_user.u_msg_limit  0 / NULL = unlimited, otherwise the total allowed
 *   js_user.u_msg_used   template messages WhatsApp accepted and did not report as failed
 *
 * The sender reserves a slot right before each template send and gives it back
 * if WhatsApp rejects the message, so parallel sends can never overshoot. The
 * status queue (webhook.ts processStatusQueue) refunds messages later reported
 * as failed, matching the "used" count the dashboard always showed.
 */

/** Message types sent through the WhatsApp template API (catalogue / product lists are session messages). */
export const LIMITED_TYPES = ['template', 'flow', 'carousel', 'Authentication'];

export const LIMIT_REACHED = 'Template message limit reached';

export const isLimitedType = (type: string | null | undefined) => LIMITED_TYPES.includes(String(type ?? ''));

export interface TemplateQuota {
  limit: number;              // 0 = unlimited
  used: number;
  remaining: number | null;   // null = unlimited
}

export function quotaOf(user: { u_msg_limit: number | null; u_msg_used: number | null }): TemplateQuota {
  const limit = Math.max(0, Number(user.u_msg_limit ?? 0));
  const used = Number(user.u_msg_used ?? 0);
  return { limit, used, remaining: limit > 0 ? Math.max(0, limit - used) : null };
}

export async function templateQuota(userId: number, db: Queryable = pool): Promise<TemplateQuota> {
  const row = await one<{ u_msg_limit: number | null; u_msg_used: number }>('SELECT u_msg_limit, u_msg_used FROM js_user WHERE u_id = $1', [userId], db);
  return quotaOf(row ?? { u_msg_limit: 0, u_msg_used: 0 });
}

/** Take one slot. False when the account has used its whole limit. */
export async function reserveTemplateSend(userId: number): Promise<boolean> {
  return (await exec(
    'UPDATE js_user SET u_msg_used = u_msg_used + 1 WHERE u_id = $1 AND (COALESCE(u_msg_limit, 0) <= 0 OR u_msg_used < u_msg_limit)',
    [userId],
  )) > 0;
}

/** Give a reserved slot back (WhatsApp did not accept the message). */
export async function releaseTemplateSend(userId: number): Promise<void> {
  await exec('UPDATE js_user SET u_msg_used = GREATEST(u_msg_used - 1, 0) WHERE u_id = $1', [userId]);
}

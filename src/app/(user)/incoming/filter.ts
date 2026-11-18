import 'server-only';
import { like } from '@/lib/db';
import { sp } from '@/lib/http';
import { parseDateRange } from '@/lib/time';

/** Incoming / Attachments listing filter, shared by the pages and their CSV export. */

type Params = Record<string, string | string[] | undefined>;

/** Attachments page: media the customer sent. */
const ATTACHMENT_TYPES = ['image', 'document', 'video', 'audio'];
/**
 * Incoming page: what the customer wrote — text, button / list replies and catalogue orders.
 * Media is on the Attachments page; unsupported, deleted / edited notices, reactions,
 * stickers, locations, contact cards and errors are left out.
 */
const MESSAGE_TYPES = ['text', 'button', 'interactive', 'order'];

export interface IncomingFilter {
  where: string;
  args: unknown[];
  readStatus: string;
  mobile: string;
  content: string;
}

export function incomingFilter(userId: number, params: Params, attachments: boolean): IncomingFilter {
  // Legacy default: show unread only until the user filters
  const readStatus = params.read_status === undefined ? '2' : sp(params, 'read_status');
  const range = parseDateRange(sp(params, 'wa_date'));
  const mobile = sp(params, 'mobile_no');
  const content = sp(params, 'content');

  const args: unknown[] = [userId];
  let where = 'm_user_id = $1 AND m_is_incoming = 1 AND m_dstatus = 0';
  // Literal lists (not parameters) so the planner can use the partial indexes
  const types = attachments ? ATTACHMENT_TYPES : MESSAGE_TYPES;
  where += ` AND m_msg_type IN (${types.map((t) => `'${t}'`).join(', ')})`;
  if (range) { args.push(range[0], range[1]); where += ` AND m_created_on BETWEEN $${args.length - 1} AND $${args.length}`; }
  if (readStatus === '1' || readStatus === '2') { args.push(Number(readStatus)); where += ` AND m_is_read = $${args.length}`; }
  if (mobile !== '') { args.push(mobile); where += ` AND m_mobile_no = $${args.length}`; }
  if (content !== '') { args.push('%' + like(content) + '%'); where += ` AND m_content ILIKE $${args.length}`; }
  return { where, args, readStatus, mobile, content };
}

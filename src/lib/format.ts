import { decodeEntities, jsonParse, limit, ucfirst } from './text';
import type { CampaignRow, CampaignStats, ContactRow, MessageRow, TemplateRow } from './types';

/**
 * Pure display helpers for rows (ports of the Eloquent accessors). No DB or
 * Node APIs here, so client components can import them too.
 */

const MESSAGE_STATUS: Record<number, string> = {
  1: 'In Que', 3: 'Send', 4: 'Cancelled', 5: 'System Cancelled', 6: 'Processing', 7: 'Invalid Mobile No', 8: 'Re-Send', 9: 'Opt Out',
};

type Msg = Partial<MessageRow>;

/** Decoded WhatsApp payload stored for incoming media / reaction / location messages. */
export function mediaInfo(m: Msg): Record<string, any> & any[] {
  if (Number(m.m_is_incoming) !== 1) return {} as Record<string, any> & any[];
  let raw = decodeEntities(m.m_image ?? '');
  if (!raw.includes('\\')) {
    // Legacy rows lost the backslashes of \uXXXX escapes ("ud83dudc4d"); restore emoji surrogate pairs
    raw = raw.replace(/u(d[89ab][0-9a-f]{2})u(d[c-f][0-9a-f]{2})/gi, '\\u$1\\u$2');
  }
  // Arrays are kept (shared contact cards are stored as a list), like the Laravel accessor
  const v = jsonParse<unknown>(raw, {});
  return (v && typeof v === 'object' ? v : {}) as Record<string, any> & any[];
}

/** Text shown in report tables: content, or template name + parameters. */
export function messageSummary(m: Msg): string {
  let text = String(m.m_content ?? '');
  if (text === '' || text === 'File_Attachment') {
    text = m.m_msg_template_name ? 'Template : ' + m.m_msg_template_name : String(m.m_msg_type ?? '');
    if (m.m_msg_template_para) text += ' : ' + m.m_msg_template_para;
  }
  return decodeEntities(text);
}

const PREVIEW_LABELS: Record<string, string> = {
  image: '📷 Photo', video: '🎥 Video', audio: '🎤 Audio', document: '📄 Document',
  sticker: 'Sticker', location: '📍 Location', contacts: '👤 Contact', order: '🛒 Order',
};

/** One-line text for the inbox conversation list. */
export function messagePreview(m: Msg): string {
  const content = decodeEntities(m.m_content ?? '');
  const type = String(m.m_msg_type ?? '');
  if (type === 'reaction') return 'Reacted ' + (mediaInfo(m).emoji ?? '');
  if (PREVIEW_LABELS[type] && Number(m.m_is_incoming) === 1) {
    return (PREVIEW_LABELS[type] + ' ' + (mediaInfo(m).caption ?? '')).trim();
  }
  if (content === '' || content === 'File_Attachment') {
    return m.m_msg_template_name ? 'Template: ' + m.m_msg_template_name : ucfirst(type);
  }
  return content.replace(/\s+/g, ' ');
}

/** Sent with status 3 but no WhatsApp id = the API rejected it ("Reports Error"). */
export function isErrorMessage(m: Msg): boolean {
  return Number(m.m_status) === 3 && !m.m_message_id;
}

/** Status label following the legacy report logic (API error, delivery status, or queue status). */
export function messageStatusLabel(m: Msg): string {
  if (Number(m.m_status) === 3) {
    if (!m.m_message_id) {
      const err = jsonParse<any>(decodeEntities(m.m_status_response ?? ''), null);
      return err?.[0]?.error?.message ?? err?.message ?? (m.m_status_response || 'Access Key Error');
    }
    return m.m_delivery_status || 'Send';
  }
  return MESSAGE_STATUS[Number(m.m_status)] ?? '';
}

// ------------------------------------------------------------------ contacts

export function contactDisplayName(c: Pick<ContactRow, 'cl_name' | 'cl_mobile_no'>): string {
  return String(c.cl_name || c.cl_mobile_no || '');
}

/** Initials for the avatar: first letters of the first two words, or the last two digits. */
export function contactInitials(c: Pick<ContactRow, 'cl_name' | 'cl_mobile_no'>): string {
  if (!c.cl_name) return String(c.cl_mobile_no ?? '').slice(-2);
  const words = c.cl_name.trim().split(/\s+/);
  return (Array.from(words[0] ?? '')[0] ?? '').concat(Array.from(words[1] ?? '')[0] ?? '').toUpperCase();
}

/** Seconds left in the 24-hour customer service window (0 when closed). */
export function contactWindowLeft(c: Pick<ContactRow, 'cl_last_in'>, nowSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.max(0, Number(c.cl_last_in) + 86400 - nowSeconds);
}

// ------------------------------------------------------------------ templates

export interface TemplateButton {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[];
  [key: string]: unknown;
}

export interface TemplateCard {
  header_type: string;
  header: string;
  body: string;
  buttons: TemplateButton[];
}

export function templateButtons(t: Pick<TemplateRow, 'ut_buttons'>): TemplateButton[] {
  const v = jsonParse<unknown>(decodeEntities(t.ut_buttons ?? ''), []);
  return Array.isArray(v) ? (v as TemplateButton[]) : [];
}

/** Carousel cards: [{header_type, header, body, buttons}] */
export function templateCards(t: Pick<TemplateRow, 'ut_cards'>): TemplateCard[] {
  const v = jsonParse<unknown>(t.ut_cards ?? '', []);
  return Array.isArray(v) ? (v as TemplateCard[]) : [];
}

/** Distinct {{n}} placeholder numbers in the text, sorted. */
export function templateVariables(text: unknown): number[] {
  const found = new Set<number>();
  for (const m of String(text ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(parseInt(m[1], 10));
  return [...found].sort((a, b) => a - b);
}

/** Number of distinct {{n}} placeholders in a piece of template text. */
export function countVariables(text: unknown): number {
  return new Set([...String(text ?? '').matchAll(/\{\{\s*\d+\s*\}\}/g)].map((m) => m[0])).size;
}

/** Number of {{n}} body parameters, from Meta example data or the body text. */
export function templateParameterCount(t: Pick<TemplateRow, 'ut_parameters' | 'ut_message'>): number {
  const params = jsonParse<any>(decodeEntities(t.ut_parameters ?? ''), null);
  const first = params?.body_text?.[0];
  if (Array.isArray(first) && first.length) return first.length;
  return countVariables(t.ut_message);
}

// ------------------------------------------------------------------ campaigns

export function campaignTitle(c: Pick<CampaignRow, 'uc_name' | 'uc_template'>): string {
  return String(c.uc_name || c.uc_template || '');
}

export function campaignGroupIds(c: Pick<CampaignRow, 'uc_group_ids'>): number[] {
  return String(c.uc_group_ids ?? '')
    .split(',')
    .map((v) => parseInt(v, 10))
    .filter((n) => n > 0);
}

/** Campaigns from before messages were linked to their campaign have no per-message stats. */
export function campaignIsTracked(c: Pick<CampaignRow, 'uc_started_at' | 'uc_status'>): boolean {
  return Number(c.uc_started_at) > 0 || Number(c.uc_status) === 1;
}

/** When it went (or goes) out: dispatch time, schedule, or creation for legacy rows (unix seconds). */
export function campaignSendAt(c: Pick<CampaignRow, 'uc_started_at' | 'uc_scheduled_at' | 'uc_created_on'>): number {
  if (c.uc_started_at) return c.uc_started_at;
  if (c.uc_scheduled_at) return c.uc_scheduled_at;
  const t = Date.parse(String(c.uc_created_on).replace(' ', 'T'));
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/** Scheduled / Sending / Completed / Cancelled, from the stored status and live stats. */
export function campaignStatusLabel(c: Pick<CampaignRow, 'uc_status' | 'uc_started_at'>, stats: CampaignStats | null): string {
  if (Number(c.uc_status) === 4) return 'Cancelled';
  if (Number(c.uc_status) === 1) return 'Scheduled';
  if (!campaignIsTracked(c)) return 'Sent';
  if ((stats?.pending ?? 0) > 0) return 'Sending';
  return 'Completed';
}

/** Short preview for list cells. */
export function preview(text: unknown, max = 250): string {
  return limit(text, max, '…');
}

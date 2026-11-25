/**
 * Quick Replies: an automatic answer to a keyword (message, media, buttons with optional
 * media, or a list). Shared by the editor (browser) and the webhook (server): types,
 * limits, validation and keyword matching.
 */
import { LIMITS, parseKeywords, uploadProblem } from './bot-flow';

export type QrType = 'text' | 'media' | 'buttons' | 'list';
/** 1 the whole message is the keyword · 2 contains · 3 starts with · 4 ends with */
export type QrMatch = 1 | 2 | 3 | 4;

export const QR_TYPES: { value: QrType; label: string; icon: string; hint: string }[] = [
  { value: 'text', label: 'Message', icon: 'ri-chat-3-line', hint: 'Plain WhatsApp text' },
  { value: 'media', label: 'Media', icon: 'ri-attachment-2', hint: 'Image, video, document or audio with a caption' },
  { value: 'buttons', label: 'Buttons', icon: 'ri-checkbox-multiple-line', hint: 'Message with up to 3 reply buttons, optional media on top' },
  { value: 'list', label: 'List', icon: 'ri-list-check-2', hint: 'Message with a menu of up to 10 items' },
];

export const QR_MATCHES: { value: QrMatch; label: string; hint: string }[] = [
  { value: 1, label: 'Is exactly', hint: 'The whole message is the keyword (e.g. “price”)' },
  { value: 2, label: 'Contains', hint: 'The keyword is anywhere in the message (e.g. “what is the price?”)' },
  { value: 3, label: 'Starts with', hint: 'The message begins with the keyword (e.g. “price of …”)' },
  { value: 4, label: 'Ends with', hint: 'The message ends with the keyword (e.g. “… price”)' },
];
export const matchLabel = (m: number) => QR_MATCHES.find((x) => x.value === Number(m))?.label ?? 'Is exactly';
export const typeInfo = (t: string) => QR_TYPES.find((x) => x.value === t) ?? QR_TYPES[0];

export interface QrRow { title: string; description: string }
export interface QrData {
  text: string;        // message / caption / body
  media: string;       // public URL (media; optional header of buttons)
  footer: string;      // buttons / list
  buttons: string[];   // buttons
  listLabel: string;   // list: the button that opens the menu
  rows: QrRow[];       // list items
}

export const QR_LIMITS = { ...LIMITS, name: 100, keyword: 60, keywords: 50, text: 4096, body: 1024 };
/** Variables a reply can use. */
export const QR_VARS = ['name', 'mobile'];

export const emptyData = (): QrData => ({ text: '', media: '', footer: '', buttons: ['', ''], listLabel: 'Options', rows: [{ title: '', description: '' }] });

const str = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

/** Keep only what the type uses, trimmed and cut to WhatsApp's limits. */
export function sanitizeData(type: QrType, raw: unknown): QrData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = emptyData();
  d.buttons = [];
  d.rows = [];
  d.listLabel = '';
  d.text = str(r.text, type === 'text' || type === 'media' ? QR_LIMITS.text : QR_LIMITS.body);
  if (type === 'media' || type === 'buttons') d.media = str(r.media, QR_LIMITS.url);
  if (type === 'buttons' || type === 'list') d.footer = str(r.footer, QR_LIMITS.footer);
  if (type === 'buttons') d.buttons = (Array.isArray(r.buttons) ? r.buttons : []).slice(0, QR_LIMITS.buttons).map((b) => str(b, QR_LIMITS.button));
  if (type === 'list') {
    d.listLabel = str(r.listLabel, QR_LIMITS.listLabel);
    d.rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, QR_LIMITS.rows).map((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      return { title: str(o.title, QR_LIMITS.rowTitle), description: str(o.description, QR_LIMITS.rowDescription) };
    });
  }
  return d;
}

export const isQrType = (t: unknown): t is QrType => QR_TYPES.some((x) => x.value === t);
export const isQrMatch = (m: unknown): m is QrMatch => [1, 2, 3, 4].includes(Number(m));

/** Keywords as typed (comma / new line separated) → lower-case, unique. */
export const qrKeywords = (raw: string): string[] => parseKeywords(raw).map((k) => k.replace(/\s+/g, ' '));

const extOf = (url: string) => (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1] ?? '').toLowerCase();
const AUDIO = ['mp3', 'ogg', 'aac', 'amr', 'm4a'];

/** Field → problem; empty when the reply can be saved. */
export function validateReply(input: { name: string; keywords: string[]; type: QrType; data: QrData }): Record<string, string> {
  const e: Record<string, string> = {};
  const { name, keywords, type, data: d } = input;
  if (!name.trim()) e.name = 'Enter a name for the quick reply.';
  if (!keywords.length) e.keywords = 'Enter at least one keyword.';
  else if (keywords.length > QR_LIMITS.keywords) e.keywords = `Use at most ${QR_LIMITS.keywords} keywords.`;
  else if (keywords.some((k) => k.length > QR_LIMITS.keyword)) e.keywords = `A keyword can be at most ${QR_LIMITS.keyword} characters.`;

  if (type !== 'media' && !d.text) e.text = 'Enter the message.';
  if (type === 'media' && !d.media) e.media = 'Upload the file (or paste its link).';
  if (d.media) {
    if (!/^https?:\/\/\S+$/i.test(d.media)) e.media = 'The file link must start with https://';
    else if (uploadProblem('f.' + extOf(d.media), 0)) e.media = 'Use an image (JPG, PNG), video (MP4), document (PDF, Word, Excel…) or audio file.';
    else if (type === 'buttons' && AUDIO.includes(extOf(d.media))) e.media = 'Buttons can show an image, video or document on top, not audio.';
  }
  if (type === 'media' && d.media && AUDIO.includes(extOf(d.media)) && d.text) e.text = 'WhatsApp sends audio without a caption: clear the caption.';
  if (type === 'buttons') {
    if (!d.buttons.length || d.buttons.some((b) => !b)) e.buttons = 'Enter a title for every button (1 to 3 buttons).';
    else if (new Set(d.buttons.map((b) => b.toLowerCase())).size !== d.buttons.length) e.buttons = 'Every button needs a different title.';
  }
  if (type === 'list') {
    if (!d.listLabel) e.listLabel = 'Enter the label of the menu button (e.g. “Options”).';
    if (!d.rows.length || d.rows.some((r) => !r.title)) e.rows = 'Enter a title for every item (1 to 10 items).';
    else if (new Set(d.rows.map((r) => r.title.toLowerCase())).size !== d.rows.length) e.rows = 'Every item needs a different title.';
  }
  return e;
}

/** A customer's message as it is compared: lower-case, single spaces, trimmed. */
export const normalizeMessage = (t: string) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A keyword matches as a whole word (or words) for contains / starts / ends; “hi” doesn't match “this”. */
export function keywordMatches(message: string, keyword: string, match: number): boolean {
  const m = normalizeMessage(message);
  const k = normalizeMessage(keyword);
  if (!m || !k) return false;
  if (Number(match) === 1) return m === k;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word edges: start / end of the message, or a character that is not a letter or digit
  const left = '(?:^|[^\\p{L}\\p{N}])';
  const right = '(?:$|[^\\p{L}\\p{N}])';
  if (Number(match) === 3) return new RegExp(`^${esc}${right}`, 'u').test(m);
  if (Number(match) === 4) return new RegExp(`${left}${esc}$`, 'u').test(m);
  return new RegExp(`${left}${esc}${right}`, 'u').test(m);
}

/** Which match wins when several quick replies fit: exact, then starts with, ends with, contains. */
const RANK: Record<number, number> = { 1: 0, 3: 1, 4: 2, 2: 3 };

/**
 * The quick reply for a message: the best match kind first, then the longest keyword
 * (more specific), then the newest reply.
 */
export function pickReply<T extends { id: number; keywords: string[]; match: number }>(replies: T[], message: string): T | null {
  let best: { r: T; rank: number; len: number } | null = null;
  for (const r of replies) {
    for (const k of r.keywords) {
      if (!keywordMatches(message, k, r.match)) continue;
      const rank = RANK[Number(r.match)] ?? 9;
      const len = normalizeMessage(k).length;
      if (!best || rank < best.rank || (rank === best.rank && (len > best.len || (len === best.len && r.id > best.r.id)))) best = { r, rank, len };
    }
  }
  return best?.r ?? null;
}

/** {{name}} / {{mobile}} filled in. */
export function fillVars(text: string, vars: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (all, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : all));
}

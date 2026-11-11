/**
 * JSON shapes the inbox route handlers return (the Laravel version returned
 * server-rendered HTML fragments; these carry the same display data, already
 * formatted on the server, and ChatInbox.tsx renders the markup).
 */

/** One conversation row (_conversation.blade.php). */
export interface ConvRow {
  mobile: string;
  last: number; // cl_last_msg_id, used to place rows by recency
  unread: number;
  hue: number;
  initials: string;
  name: string;
  time: string;
  preview: string;
  outgoing: boolean; // last message was ours (reply icon)
  live: boolean; // reply window open
}

/** Thread header (_header.blade.php). */
export interface ThreadHeader {
  mobile: string;
  name: string;
  initials: string;
  hue: number;
  showMobile: boolean;
}

export type BubbleMedia =
  | { kind: 'image'; type: 'image' | 'sticker'; href: string }
  | { kind: 'video' | 'audio'; href: string; name: string }
  | { kind: 'file'; icon: string; name: string; href: string }
  | { kind: 'location'; name: string; href: string }
  | { kind: 'reaction'; emoji: string }
  | { kind: 'contacts'; names: string };

export type Tick = 'error' | 'read' | 'delivered' | 'sent' | 'failed' | 'pending';

/** Header of a sent template: text, or the media that went out with it. */
export type TemplateHeader =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video' | 'document'; url: string; name: string };

export interface TemplateButtonView {
  icon: string;
  text: string;
}

/** A sent template rebuilt from js_user_templates + the message parameters. */
export interface RenderedTemplate {
  header: TemplateHeader | null;
  html: string; // body with {{n}} filled in, WhatsApp-formatted and escaped
  footer: string;
  buttons: TemplateButtonView[];
  cards: { header: TemplateHeader | null; html: string; buttons: TemplateButtonView[] }[];
}

/** One message bubble (_bubble.blade.php). */
export interface Bubble {
  id: number;
  out: boolean;
  day: string; // Y-m-d, for the day separators
  time: string; // H:i
  failed: boolean;
  status: string; // status label (error text / tooltip)
  tick: Tick | null;
  media: BubbleMedia | null;
  files: { url: string; image: boolean; name: string }[];
  template: { name: string; para: string } | null; // fallback when the template row is gone
  rendered: RenderedTemplate | null;
  html: string | null; // WhatsApp-formatted text, already escaped
  placeholder: string | null;
  /** The message this one replies to (swiped reply / template button), shown quoted on top. */
  quote: BubbleQuote | null;
}

export interface BubbleQuote {
  id: number;      // js_message id of the quoted message (to jump to it when loaded)
  out: boolean;    // quoted message was sent by the business ("You")
  text: string;    // plain-text preview
  button?: string; // template button the customer tapped
}

export interface ListResponse {
  rows: ConvRow[];
  before: number | null;
  more: boolean;
  unread_total: number;
}

export interface ThreadResponse {
  messages: Bubble[];
  oldest: number | null;
  newest: number | null;
  more: boolean;
  header?: ThreadHeader;
  window_left?: number;
  row?: ConvRow | null;
  unread_total?: number;
}

export interface PollResponse {
  now: number;
  rows: Record<string, ConvRow>;
  messages: Bubble[];
  newest?: number | null;
  statuses: Bubble[];
  window_left?: number;
  unread_total: number;
}

export interface SendResponse {
  message: Bubble;
  id: number;
  error: string | null;
  row: ConvRow;
  /** Set when a template was queued instead of sent (outside the sending window). */
  notice?: string | null;
}

export interface TemplateListResponse {
  templates: { ut_id: number; ut_name: string }[];
  window: { open: boolean; label: string };
}

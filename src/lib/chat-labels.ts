/** Inbox chat labels (js_chat_label): colours and limits. Pure — usable on the server and client. */

export interface ChatLabel { id: number; name: string; color: LabelColor; count: number }

/** Label colours: key → [text / dot colour, background]. */
export const LABEL_COLORS = {
  green: ['#0f9d58', '#e3f6ec'],
  blue: ['#1a73e8', '#e4eefc'],
  purple: ['#8e44ad', '#f1e6f7'],
  orange: ['#e67e22', '#fdf0e3'],
  red: ['#d93025', '#fbe7e6'],
  teal: ['#00897b', '#e0f2f1'],
  pink: ['#d81b60', '#fce4ec'],
  gray: ['#5f6368', '#eceff1'],
} as const;
export type LabelColor = keyof typeof LABEL_COLORS;
export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export const MAX_LABELS = 50;
export const MAX_LABEL_NAME = 30;

export const labelColor = (c: string): LabelColor => (c in LABEL_COLORS ? (c as LabelColor) : 'gray');

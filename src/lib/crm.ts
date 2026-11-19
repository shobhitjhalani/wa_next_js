/**
 * Leads CRM (/crm): statuses, sources and follow-up types shared by the pages, the webhook and the
 * reminder job. Client-safe (no server imports).
 */

export const LEAD_STATUS = { NEW: 1, CONTACTED: 2, INTERESTED: 3, WON: 4, LOST: 5 } as const;
/** Statuses that still need follow-ups (reminders only fire for these). */
export const OPEN_STATUSES = [LEAD_STATUS.NEW, LEAD_STATUS.CONTACTED, LEAD_STATUS.INTERESTED] as const;

export const STATUS_INFO: Record<number, { label: string; badge: string }> = {
  1: { label: 'New', badge: 'bg-info-subtle text-info' },
  2: { label: 'Contacted', badge: 'bg-primary-subtle text-primary' },
  3: { label: 'Interested', badge: 'bg-warning-subtle text-warning' },
  4: { label: 'Won', badge: 'bg-success-subtle text-success' },
  5: { label: 'Lost', badge: 'bg-danger-subtle text-danger' },
};

export const LEAD_SOURCES: { value: string; label: string; icon: string }[] = [
  { value: 'facebook', label: 'Facebook', icon: 'ri-facebook-circle-fill text-primary' },
  { value: 'instagram', label: 'Instagram', icon: 'ri-instagram-line text-danger' },
  { value: 'google', label: 'Google', icon: 'ri-google-fill text-warning' },
  { value: 'website', label: 'Website', icon: 'ri-global-line text-info' },
  { value: 'whatsapp', label: 'WhatsApp', icon: 'ri-whatsapp-line text-success' },
  { value: 'linkedin', label: 'LinkedIn', icon: 'ri-linkedin-box-fill text-primary' },
  { value: 'youtube', label: 'YouTube', icon: 'ri-youtube-fill text-danger' },
  { value: 'manual', label: 'Added by hand', icon: 'ri-user-add-line text-secondary' },
  { value: 'other', label: 'Other', icon: 'ri-more-line text-secondary' },
];

/** A built-in source, or an account's own source (stored by its name). */
export function sourceInfo(value: string) {
  return LEAD_SOURCES.find((s) => s.value === value) ?? { value, label: value || 'Other', icon: 'ri-price-tag-3-line text-secondary' };
}

/** Options for source pickers: the built-in sources, then the account's own (by name). */
export function sourceOptions(custom: string[]): { value: string; label: string }[] {
  return [...LEAD_SOURCES.map((s) => ({ value: s.value, label: s.label })), ...custom.map((n) => ({ value: n, label: n }))];
}

/** Is `name` already a built-in source (its key or label)? Own sources may not reuse them. */
export function isBuiltInSource(name: string): boolean {
  const n = name.trim().toLowerCase();
  return LEAD_SOURCES.some((s) => s.value === n || s.label.toLowerCase() === n);
}

export const MAX_CUSTOM_SOURCES = 50;
export const MAX_SOURCE_NAME = 40;

/** A source name sent by a webhook / form → one of LEAD_SOURCES ('other' when unknown). */
export function normalizeSource(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return 'other';
  if (v === 'fb' || v.includes('facebook') || v.includes('meta')) return 'facebook';
  if (v === 'ig' || v.includes('instagram') || v.includes('insta')) return 'instagram';
  if (v.includes('google') || v.includes('adwords')) return 'google';
  if (v.includes('whatsapp') || v === 'wa') return 'whatsapp';
  if (v.includes('linkedin')) return 'linkedin';
  if (v.includes('youtube') || v === 'yt') return 'youtube';
  if (v.includes('web') || v.includes('site') || v.includes('landing')) return 'website';
  return LEAD_SOURCES.some((s) => s.value === v) ? v : 'other';
}

export const FOLLOWUP_TYPES: { value: string; label: string; icon: string }[] = [
  { value: 'call', label: 'Call', icon: 'ri-phone-line' },
  { value: 'whatsapp', label: 'WhatsApp', icon: 'ri-whatsapp-line' },
  { value: 'meeting', label: 'Meeting / visit', icon: 'ri-team-line' },
  { value: 'email', label: 'Email', icon: 'ri-mail-line' },
  { value: 'note', label: 'Note', icon: 'ri-sticky-note-line' },
];

export function followupTypeInfo(value: string) {
  return FOLLOWUP_TYPES.find((t) => t.value === value) ?? { value, label: 'Update', icon: 'ri-information-line' };
}

/** Reminder lead times offered in the settings (minutes before the follow-up time). */
export const REMIND_BEFORE: { value: number; label: string }[] = [
  { value: 0, label: 'At the follow-up time' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 180, label: '3 hours before' },
  { value: 1440, label: '1 day before' },
];

export const CRM_LIMITS = { name: 120, email: 160, campaign: 200, notes: 4000, note: 4000, fields: 60, fieldValue: 1000 };

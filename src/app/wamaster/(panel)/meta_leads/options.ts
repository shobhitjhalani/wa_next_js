/** Choices for the Meta Lead Ads forms (client-safe). */

export const CTAS = ['SIGN_UP', 'LEARN_MORE', 'APPLY_NOW', 'GET_QUOTE', 'SUBSCRIBE', 'CONTACT_US', 'DOWNLOAD', 'GET_OFFER', 'BOOK_TRAVEL'];

export const ctaLabel = (c: string) => c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ');

export const SPECIAL_CATEGORIES = [
  { value: 'HOUSING', label: 'Housing' },
  { value: 'EMPLOYMENT', label: 'Employment' },
  { value: 'FINANCIAL_PRODUCTS_SERVICES', label: 'Financial products / credit' },
  { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Social issues, elections or politics' },
];

export const STATUS_BADGE: Record<string, { label: string; badge: string }> = {
  queued: { label: 'Queued', badge: 'bg-secondary-subtle text-secondary' },
  running: { label: 'Creating…', badge: 'bg-info-subtle text-info' },
  paused: { label: 'Created · paused', badge: 'bg-warning-subtle text-warning' },
  failed: { label: 'Failed', badge: 'bg-danger-subtle text-danger' },
  activating: { label: 'Activating…', badge: 'bg-info-subtle text-info' },
  active: { label: 'Active', badge: 'bg-success-subtle text-success' },
};

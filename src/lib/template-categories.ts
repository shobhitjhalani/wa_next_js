/**
 * Which WhatsApp template categories an account may send, set by admins on the
 * user form (e.g. a client sold "utility only" — no marketing messages).
 *
 *   js_user.u_template_categories  NULL / '' = every category,
 *                                  otherwise a comma list such as 'UTILITY' or 'UTILITY,AUTHENTICATION'
 *
 * Client-safe (no server imports): the admin form and the template form use it too.
 * Pickers hide templates of other categories, template creation only offers the
 * allowed ones, campaigns and the API refuse them, and the sender is the final
 * guard (a template Meta re-categorised after approval is refused at send time).
 */

export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Authentication',
};

export const CATEGORY_NOT_ALLOWED = 'Template category not allowed for this account';

/** Allowed categories, or null when every category is allowed. */
export function allowedCategories(raw: string | null | undefined): TemplateCategory[] | null {
  const list = String(raw ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is TemplateCategory => (TEMPLATE_CATEGORIES as readonly string[]).includes(c));
  return list.length && list.length < TEMPLATE_CATEGORIES.length ? [...new Set(list)] : null;
}

/** Column value for a set of ticked categories: null when all (or none, treated as all) are ticked. */
export function categoriesValue(list: string[]): string | null {
  const allowed = allowedCategories(list.join(','));
  return allowed ? TEMPLATE_CATEGORIES.filter((c) => allowed.includes(c)).join(',') : null;
}

export function categoryAllowed(raw: string | null | undefined, category: string | null | undefined): boolean {
  const allowed = allowedCategories(raw);
  return allowed === null || allowed.includes(String(category ?? '').toUpperCase() as TemplateCategory);
}

/** "Utility" / "Utility, Authentication" / "All" for display. */
export function categoriesLabel(raw: string | null | undefined): string {
  const allowed = allowedCategories(raw);
  return allowed ? allowed.map((c) => CATEGORY_LABELS[c]).join(', ') : 'All';
}

/** User-facing refusal, e.g. "Only Utility templates can be sent from this account." */
export function categoryRefusal(raw: string | null | undefined): string {
  return `Only ${categoriesLabel(raw)} templates can be sent from this account. Please contact support to enable other categories.`;
}

/** Categories the account may create templates in (the create form offers Marketing and Utility). */
export function creatableCategories(raw: string | null | undefined): ('MARKETING' | 'UTILITY')[] {
  return (['MARKETING', 'UTILITY'] as const).filter((c) => categoryAllowed(raw, c));
}

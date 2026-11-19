/**
 * Account team members (/team): what a member may do inside the owner's account. Client-safe.
 * The owner always has every right; a member has only what the owner ticked.
 */

export interface TeamPerms {
  /** WA Templates: none · view the list · view + create / edit / delete. */
  template: 'none' | 'view' | 'edit';
  /** Campaigns: may create (compose) new campaigns. */
  campaignCreate: boolean;
  /** Campaigns list and reports: none · only the campaigns this member created · every campaign of the account. */
  campaignView: 'none' | 'own' | 'all';
  /** Inbox: none · only chats assigned to this member · every chat (and may assign chats). */
  inbox: 'none' | 'own' | 'all';
}

export const OWNER_PERMS: TeamPerms = { template: 'edit', campaignCreate: true, campaignView: 'all', inbox: 'all' };
export const NO_PERMS: TeamPerms = { template: 'none', campaignCreate: false, campaignView: 'none', inbox: 'none' };

/** Stored JSON → TeamPerms (unknown values become "none"). */
export function normalizePerms(raw: unknown): TeamPerms {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T => (allowed.includes(v as T) ? (v as T) : allowed[0]);
  return {
    template: pick(r.template, ['none', 'view', 'edit'] as const),
    campaignCreate: r.campaignCreate === true,
    campaignView: pick(r.campaignView, ['none', 'own', 'all'] as const),
    inbox: pick(r.inbox, ['none', 'own', 'all'] as const),
  };
}

export const PERM_OPTIONS = {
  template: [
    { value: 'none', label: 'No access' },
    { value: 'view', label: 'View' },
    { value: 'edit', label: 'View, create & update' },
  ],
  campaignView: [
    { value: 'none', label: 'No access' },
    { value: 'own', label: 'View own campaigns' },
    { value: 'all', label: 'View all campaigns' },
  ],
  inbox: [
    { value: 'none', label: 'No access' },
    { value: 'own', label: 'Own chats (assigned to them)' },
    { value: 'all', label: 'All chats (and can assign)' },
  ],
} as const;

/** One-line summary for the team list, e.g. "Templates: view · Campaigns: create, own · Inbox: own". */
export function permSummary(p: TeamPerms): string[] {
  const out: string[] = [];
  if (p.template !== 'none') out.push(`Templates: ${p.template === 'edit' ? 'view & edit' : 'view'}`);
  const camp = [p.campaignCreate && 'create', p.campaignView === 'own' ? 'view own' : p.campaignView === 'all' ? 'view all' : ''].filter(Boolean);
  if (camp.length) out.push(`Campaigns: ${camp.join(', ')}`);
  if (p.inbox !== 'none') out.push(`Inbox: ${p.inbox === 'own' ? 'own chats' : 'all chats'}`);
  return out;
}

/** Where a member lands after signing in (the first section they may open). */
export function memberHome(p: TeamPerms): string {
  if (p.inbox !== 'none') return '/chat';
  if (p.campaignView !== 'none') return '/campaigns';
  if (p.campaignCreate) return '/compose';
  if (p.template !== 'none') return '/templates';
  return '/team/account';
}

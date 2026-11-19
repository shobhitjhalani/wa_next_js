import 'server-only';
import { teamAccount } from '@/lib/auth';
import { value } from '@/lib/db';
import type { UserRow } from '@/lib/types';
import { mobileVariants } from './inbox';

/**
 * Who may use the inbox, and which chats: the owner and "All chats" members see every chat and
 * can assign chats; "Own chats" members only see chats assigned to them (scope = their member id).
 */
export interface InboxAccess {
  user: UserRow;
  /** 0 = every chat; otherwise only chats assigned to this member id. */
  scope: number;
  /** May assign chats to team members (owner, "All chats" members). */
  canAssign: boolean;
  /** The signed-in team member's id (0 = the owner). */
  memberId: number;
}

export async function inboxAccess(): Promise<InboxAccess | null> {
  const a = await teamAccount((p) => p.inbox !== 'none');
  if (!a) return null;
  return {
    user: a.user,
    scope: a.member && a.perms.inbox === 'own' ? a.member.um_id : 0,
    canAssign: !a.member || a.perms.inbox === 'all',
    memberId: a.member?.um_id ?? 0,
  };
}

/** May this inbox user open / message the chat with `mobile`? ("Own chats" members: only chats assigned to them.) */
export async function canOpenChat(access: InboxAccess, mobile: string): Promise<boolean> {
  if (!access.scope) return true;
  // Messages may carry the number with or without the country code
  return !!(await value('SELECT 1 FROM js_user_contact_list WHERE cl_user_id = $1 AND cl_mobile_no = ANY($2::text[]) AND cl_assigned_member = $3',
    [access.user.u_id, mobileVariants(mobile), access.scope]));
}

/** The `assigned` list filter: '' (everyone), 'none' (unassigned) or a member id. */
export function assignedParam(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return s === 'none' || /^\d{1,9}$/.test(s) ? s : '';
}

export const NOT_YOURS = 'This chat is not assigned to you.';

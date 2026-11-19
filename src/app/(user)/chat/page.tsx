import type { Metadata } from 'next';
import { requireTeam } from '@/lib/auth';
import { query } from '@/lib/db';
import { sp } from '@/lib/http';
import { PageTitle } from '@/components/PageTitle';
import { ChatInbox, type InboxTeam } from './ChatInbox';
import { cleanMobile, unreadTotal } from './inbox';

export const metadata: Metadata = { title: 'Inbox' };

/** WhatsApp inbox (User\ChatController::index); ?mb= opens that conversation. Owner, or team members with inbox access. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, member, perms } = await requireTeam((p) => p.inbox !== 'none');
  const params = await searchParams;
  const selected = cleanMobile(sp(params, 'mb'));
  const scope = member && perms.inbox === 'own' ? member.um_id : 0;
  const [total, members] = await Promise.all([
    unreadTotal(user.u_id, scope),
    // Members who can work in the inbox: the people a chat can be assigned to
    query<{ id: number; name: string }>(
      `SELECT um_id AS id, um_name AS name FROM js_user_member
        WHERE um_user_id = $1 AND um_status = 1 AND COALESCE(um_perms->>'inbox', 'none') <> 'none' ORDER BY lower(um_name)`, [user.u_id]),
  ]);
  const team: InboxTeam = { members, canAssign: !member || perms.inbox === 'all', me: member?.um_id ?? 0, ownOnly: scope > 0 };
  return (
    <>
      <PageTitle title="Inbox" home="/dashboard" />
      <ChatInbox selected={selected} unreadTotal={total} team={team} />
    </>
  );
}

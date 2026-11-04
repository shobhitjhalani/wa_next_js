import { requireUser } from '@/lib/auth';
import { sp } from '@/lib/http';
import { PageTitle } from '@/components/PageTitle';
import { ChatInbox } from './ChatInbox';
import { cleanMobile, unreadTotal } from './inbox';

/** WhatsApp inbox (User\ChatController::index); ?mb= opens that conversation. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const selected = cleanMobile(sp(params, 'mb'));
  const total = await unreadTotal(user.u_id);
  return (
    <>
      <PageTitle title="Inbox" home="/dashboard" />
      <ChatInbox selected={selected} unreadTotal={total} />
    </>
  );
}

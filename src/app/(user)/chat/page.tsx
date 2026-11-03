import ChatApp from "@/components/user/ChatApp";
import PageShell from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";
import { chatContacts } from "@/lib/user/chat";

// chat.php
export default async function ChatPage() {
  const user = await currentUser();
  const contacts = await chatContacts(user.u_id, "");
  return (
    <PageShell title="User Chat" hideTitle>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link href="/common_assets/css/custom-chat.css" rel="stylesheet" />
      <ChatApp name={user.u_name ?? ""} initial={contacts} />
    </PageShell>
  );
}

import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/panel/Shell';
import type { MenuItem } from '@/components/panel/Sidebar';

/** User panel frame (layouts/user.blade.php). Every page below requires a signed-in user. */
export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const menu: MenuItem[] = [
    { label: 'Dashboard', icon: 'ri-home-4-line', href: '/dashboard' },
    { label: 'WA Templates', icon: 'ri-file-edit-line', href: '/templates' },
    {
      label: 'Campaigns', icon: 'ri-megaphone-line', children: [
        { label: 'Dashboard', href: '/campaigns' },
        { label: 'New Campaign', href: '/compose' },
      ],
    },
    {
      label: 'Contacts', icon: 'ri-contacts-book-line', children: [
        { label: 'All Contacts', href: '/contacts', match: ['/contacts', '/contacts/export'] },
        { label: 'Groups', href: '/groups' },
        { label: 'Upload Contacts', href: '/contacts/upload', match: ['/contacts/upload'] },
      ],
    },
    {
      label: 'Incoming', icon: 'ri-chat-3-line', children: [
        { label: 'Inbox', href: '/chat' },
        { label: 'Incoming', href: '/incoming' },
        { label: 'Attachments', href: '/incoming_attachment' },
      ],
    },
    ...(Number(user.u_enable_ai) === 1
      ? [{
        label: 'AI', icon: 'ri-robot-line', children: [
          { label: 'Knowledge Base', href: '/ai/knowledge_base' },
          { label: "Do's & Don'ts", href: '/ai/do_dont' },
          { label: 'Prompts', href: '/ai/prompts' },
        ],
      } satisfies MenuItem]
      : []),
    {
      label: 'Reports', icon: 'ri-layout-grid-line', children: [
        { label: 'In Que Messages', href: '/que' },
        { label: 'Reports', href: '/reports' },
        { label: 'Reports Failed', href: '/reports_failed' },
        { label: 'Reports Error', href: '/reports_error' },
        { label: 'Templates Reports', href: '/reports_templates' },
      ],
    },
    {
      label: 'Plans', icon: 'ri-wallet-3-line', children: [
        { label: 'Recharge', href: '/wa_plans' },
        { label: 'Recharge History', href: '/recharge' },
      ],
    },
  ];

  return (
    <Shell
      home="/dashboard"
      profileUrl="/profile"
      logoutUrl="/logout"
      userName={user.u_name ?? ''}
      userSub={user.u_company_name ?? ''}
      menu={menu}
    >
      {children}
    </Shell>
  );
}

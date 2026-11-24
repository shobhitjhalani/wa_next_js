import { requireAccount } from '@/lib/auth';
import { memberHome, type TeamPerms } from '@/lib/team';
import { Shell } from '@/components/panel/Shell';
import type { MenuItem } from '@/components/panel/Sidebar';
import { API_DOCS_VISIBLE } from './api_docs/visibility';
import { CrmReminders } from './crm/CrmReminders';

/** Guide Book: step-by-step guides (Create Template, Start Campaign, Inbox). */
const GUIDE_MENU: MenuItem = { label: 'Guide Book', icon: 'ri-book-open-line', href: '/guide', match: ['/guide'] };

/** Menu of a team member: only the sections their permissions open. */
function memberMenu(p: TeamPerms): MenuItem[] {
  const campaigns = [
    ...(p.campaignView !== 'none' ? [{ label: 'Dashboard', href: '/campaigns' }] : []),
    ...(p.campaignCreate ? [{ label: 'New Campaign', href: '/compose' }] : []),
  ];
  return [
    ...(p.template !== 'none' ? [{ label: 'WA Templates', icon: 'ri-file-edit-line', href: '/templates' }] : []),
    ...(campaigns.length ? [{ label: 'Campaigns', icon: 'ri-megaphone-line', children: campaigns }] : []),
    ...(p.inbox !== 'none' ? [{ label: 'Inbox', icon: 'ri-chat-3-line', href: '/chat' }] : []),
    { label: 'My Account', icon: 'ri-user-settings-line', href: '/team/account' },
    ...(p.template === 'edit' || p.campaignCreate || p.inbox !== 'none' ? [GUIDE_MENU] : []),
  ];
}

/** User panel frame (layouts/user.blade.php). Every page below requires a signed-in user (owner or team member). */
export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const { user, member, perms } = await requireAccount();

  if (member) {
    return (
      <Shell home={memberHome(perms)} profileUrl="/team/account" logoutUrl="/logout"
        userName={member.um_name} userSub={user.u_company_name ?? user.u_name ?? ''} menu={memberMenu(perms)}>
        {children}
      </Shell>
    );
  }

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
        { label: 'Add / Upload Contacts', href: '/contacts/upload', match: ['/contacts/upload'] },
      ],
    },
    // Shown when the admin switched Chatbot Flows on for this account
    ...(Number(user.u_bot_flow) === 1 ? [{ label: 'Chatbot Flows', icon: 'ri-flow-chart', href: '/bot_flows' } satisfies MenuItem] : []),
    // Shown when the admin switched the Leads CRM on for this account
    ...(Number(user.u_crm) === 1
      ? [{
        label: 'Leads CRM', icon: 'ri-user-star-line', children: [
          { label: 'Leads', href: '/crm' },
          { label: 'Webhook & Facebook', href: '/crm/settings' },
        ],
      } satisfies MenuItem]
      : []),
    {
      label: 'Incoming', icon: 'ri-chat-3-line', children: [
        { label: 'Inbox', href: '/chat' },
        { label: 'Incoming', href: '/incoming' },
        { label: 'Flow Responses', href: '/flow_responses' },
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
        { label: 'Campaign Summary', href: '/reports_templates' },
        { label: 'Campaign Total Summary', href: '/reports_templates_summary' },
      ],
    },
    ...(API_DOCS_VISIBLE ? [{ label: 'API', icon: 'ri-code-s-slash-line', href: '/api_docs' } satisfies MenuItem] : []),
    {
      label: 'Plans', icon: 'ri-wallet-3-line', children: [
        { label: 'Recharge', href: '/wa_plans' },
        { label: 'Recharge History', href: '/recharge' },
      ],
    },
    // Shown when the admin gave this account Teams
    ...(Number(user.u_team) === 1 ? [{ label: 'My Team', icon: 'ri-team-line', href: '/team', match: ['/team'] } satisfies MenuItem] : []),
    GUIDE_MENU,
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
      {Number(user.u_crm) === 1 && <CrmReminders />}
    </Shell>
  );
}

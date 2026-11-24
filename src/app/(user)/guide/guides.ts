import type { TeamPerms } from '@/lib/team';

/**
 * Guide Book: step-by-step written guides shown in the user panel (/guide).
 * Text only, kept in code — edit the steps here when a screen changes.
 */

export interface GuideStep {
  title: string;
  /** Paragraphs; **bold** marks a button / field name. */
  text: string[];
  /** Short hints shown under the step. */
  tips?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  icon: string;
  summary: string;
  /** The page the guide is about, opened by "Open …". */
  link: { label: string; href: string };
  /** Who can follow this guide (owners pass every check). */
  canUse: (p: TeamPerms) => boolean;
  before?: string[];
  steps: GuideStep[];
}

export const GUIDES: Guide[] = [
  {
    slug: 'create-template',
    title: 'Create a WhatsApp Template',
    icon: 'ri-file-edit-line',
    summary: 'Write a message template and send it to WhatsApp for approval. Campaigns and first messages to a customer can only use approved templates.',
    link: { label: 'Open WA Templates', href: '/templates' },
    canUse: (p) => p.template === 'edit',
    before: [
      'Your WhatsApp Business account must be connected. If the Create Template button is greyed out, contact support.',
    ],
    steps: [
      {
        title: 'Open WA Templates',
        text: ['In the left menu click **WA Templates**, then click **Create Template** at the top of the page.'],
        tips: ['Use **Create Carousel** instead for a message with 2 to 10 swipeable cards.'],
      },
      {
        title: 'Name the template',
        text: [
          'Choose **Template Type**: **Standard** for a normal message.',
          'Type a **Template Name** using lowercase letters, numbers and underscores only, e.g. `diwali_offer_2026`.',
        ],
        tips: ['The name is only for you; customers never see it.'],
      },
      {
        title: 'Choose category and language',
        text: [
          '**Category**: **Marketing** for offers, promotions and announcements; **Utility** for order updates, reminders and account messages.',
          '**Language**: the language the message is written in.',
        ],
        tips: ['A promotional message sent as Utility is usually rejected or moved to Marketing by WhatsApp.'],
      },
      {
        title: 'Add a header (optional)',
        text: [
          'Pick a **Header** type: **None**, **Text**, **Image**, **Video** or **Document**.',
          'For Text, type the **Header Text** (up to 60 characters). For media, upload a **Sample Header File**; you can use a different file each time you send.',
        ],
      },
      {
        title: 'Write the body',
        text: [
          'Type the message in **Body**. Use the toolbar or type *bold*, _italic_, ~strike~ for formatting.',
          'To personalise, click **+ Add variable**: it inserts {{1}}, {{2}} … where the customer name, order number etc. will go. Fill in an example value for each variable below the body.',
        ],
        tips: [
          'Example: "Hi {{1}}, your order {{2}} has been shipped."',
          'Do not start or end the body with a variable, and do not put two variables next to each other.',
        ],
      },
      {
        title: 'Add footer and buttons (optional)',
        text: [
          '**Footer**: a short line in grey under the message, e.g. "Reply STOP to unsubscribe".',
          '**Buttons** (up to 10): **Quick reply**, **Visit website** (a URL), **Call phone**, or **Open flow (form)**.',
        ],
      },
      {
        title: 'Check the preview and submit',
        text: [
          'Check the **Template Sample View** on the right; it shows how the message looks on the phone.',
          'Click **Submit for Approval**.',
        ],
      },
      {
        title: 'Wait for approval',
        text: [
          'WhatsApp reviews new templates, usually within a few minutes and sometimes up to 24 hours.',
          'Approved templates appear in the **WA Templates** list. Click **Sync from WhatsApp** to refresh the list.',
        ],
        tips: ['Once approved, the **Send Template** button next to it starts a campaign with that template.'],
      },
    ],
  },
  {
    slug: 'start-campaign',
    title: 'Start a Campaign',
    icon: 'ri-megaphone-line',
    summary: 'Send an approved template to many customers at once: a contact group, pasted numbers or an Excel file. Send now or schedule it.',
    link: { label: 'Open New Campaign', href: '/compose' },
    canUse: (p) => p.campaignCreate,
    before: [
      'You need at least one approved template (see "Create a WhatsApp Template").',
      'Make sure you have enough balance: **Plans → Recharge**.',
    ],
    steps: [
      {
        title: 'Open New Campaign',
        text: ['In the left menu click **Campaigns → New Campaign**.'],
        tips: ['Shortcut: on **WA Templates**, click **Send Template** next to a template.'],
      },
      {
        title: 'Name the campaign (optional)',
        text: ['Type a **Campaign Name**, e.g. "Diwali offer — Jaipur customers". If left empty, the template name and date are used.'],
      },
      {
        title: 'Choose the template',
        text: [
          'Select the **Template**. The **Template Preview** on the right shows the message.',
          'If the template has a media header, upload the image / video / document to send.',
          'If it has variables ({{1}}, {{2}} …), type the value for each one. It is the same for every customer.',
        ],
        tips: ['Need a different value for each customer (their name, amount)? Use the **Excel Upload** tab in the next step and pick the column for each variable.'],
      },
      {
        title: 'Choose who receives it',
        text: [
          'Under **Audience**, use one or more tabs:',
          '**Contact Groups**: tick one or more saved groups.',
          '**Manual Numbers**: paste mobile numbers, one per line or comma separated.',
          '**Excel Upload**: upload an Excel / CSV file. Use **Download sample Excel** to see the format, then pick which column holds the mobile number.',
        ],
        tips: [
          'You can combine tabs. A number in more than one source gets the message once.',
          'Opted-out contacts are skipped automatically.',
        ],
      },
      {
        title: 'Send now or schedule',
        text: ['Under **Schedule**, choose **Send now**, or **Schedule for later** and pick the **Send At** date and time.'],
      },
      {
        title: 'Review and send',
        text: [
          'Click **Preview & Send**. The **Review Campaign** window shows the template, total recipients and send time.',
          'Click **Click to Send** (or **Click to Schedule**). Click **Back** to change something.',
        ],
      },
      {
        title: 'Track delivery',
        text: [
          'Open **Campaigns → Dashboard** to see every campaign with its recipients, delivery and status. Click **View** for the full report: pending, sent, delivered, read and failed.',
        ],
        tips: ['Messages that could not be delivered are listed under **Reports → Reports Failed** with the reason.'],
      },
    ],
  },
  {
    slug: 'inbox',
    title: 'Reply to Customers in the Inbox',
    icon: 'ri-chat-3-line',
    summary: 'Read and answer customer messages, start a chat with a new number, label and assign chats.',
    link: { label: 'Open Inbox', href: '/chat' },
    canUse: (p) => p.inbox !== 'none',
    steps: [
      {
        title: 'Open the Inbox',
        text: [
          'In the left menu click **Incoming → Inbox** (team members: **Inbox**).',
          'The left side lists the chats, newest first; unread chats show a count. New messages appear automatically.',
        ],
      },
      {
        title: 'Find a chat',
        text: [
          'Use **Search name or number** at the top of the list.',
          'Filter by team member (**All chats**, **Unassigned**, **Assigned to …**) or by label.',
        ],
      },
      {
        title: 'Reply',
        text: [
          'Click a chat to open it. Type in **Type a message** and press Enter or the send button.',
          'Use the paperclip to attach a file (image, video, PDF …).',
        ],
        tips: ['The ticks on your messages show Sent, Delivered and Read (blue).'],
      },
      {
        title: 'Understand the 24-hour window',
        text: [
          'WhatsApp lets you send free text only within 24 hours of the customer’s last message.',
          'After that the box shows "The 24-hour reply window is closed". Click **Send Template** to send an approved template; when the customer answers, free text is allowed again.',
        ],
      },
      {
        title: 'Start a chat with a new number',
        text: [
          'Click the new-chat button at the top of the list, type the **Mobile number** (e.g. 9876543210) and open it.',
          'The first message to a new number must be a template: click **Send Template**, choose the template, fill its values and send.',
        ],
      },
      {
        title: 'Label a chat',
        text: [
          'Use **Label this chat** in the open chat to tag it, e.g. "Hot lead", "Payment pending". Create a **New label** and pick a colour the first time.',
          'Use the label filter in the chat list to see all chats with a label.',
        ],
      },
      {
        title: 'Assign a chat to a team member (Teams accounts)',
        text: [
          'Click **Assign to team** in the open chat and pick the member who should handle it, or **Unassign**.',
          'Team members with "own chats" access see only the chats assigned to them.',
        ],
      },
    ],
  },
];

export function guidesFor(perms: TeamPerms): Guide[] {
  return GUIDES.filter((g) => g.canUse(perms));
}

/** Yes/No flags stored as 1 = Yes, 2 = No (UserController::FLAGS). */
export const FLAGS = ['send_wa', 'wa_enable_incoming', 'wa_enable_catalogue', 'send_app', 'is_new_no', 'enable_ai', 'bot_flow', 'crm', 'google_sheet', 'wa_coexistence', 'own_account', 'team', 'bulk_post', 'ads'] as const;

/** The Permissions group of a WhatsApp account (what its user panel offers). */
export const PERMISSIONS: { flag: (typeof FLAGS)[number]; label: string; icon: string; hint: string }[] = [
  { flag: 'bot_flow', label: 'Chatbot Flows', icon: 'ri-flow-chart', hint: 'Chatbot Flows menu and builder' },
  { flag: 'crm', label: 'Leads CRM', icon: 'ri-user-star-line', hint: 'Leads CRM menu, webhook & Facebook leads' },
  { flag: 'bulk_post', label: 'Bulk Posting', icon: 'ri-facebook-circle-line', hint: 'Facebook bulk posting' },
  { flag: 'team', label: 'Teams', icon: 'ri-team-line', hint: 'My Team menu and team member logins' },
  { flag: 'ads', label: 'Ads Management', icon: 'ri-megaphone-line', hint: 'Meta Lead Ads for this account' },
];

/** WhatsApp-user switches that carry a value: shown while on, cleared when off. */
export const WA_FLAG_FIELDS = {
  send_wa: 'wa_form_url',
  wa_enable_catalogue: 'wa_catalogue_url',
  send_app: 'wa_app_url',
  enable_ai: 'ai_key',
} as const;

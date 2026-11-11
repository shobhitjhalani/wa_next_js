/** Yes/No flags stored as 1 = Yes, 2 = No (UserController::FLAGS). */
export const FLAGS = ['send_wa', 'wa_enable_incoming', 'wa_enable_catalogue', 'send_app', 'is_new_no', 'enable_ai', 'google_sheet', 'wa_coexistence', 'own_account'] as const;

/** WhatsApp-user switches that carry a value: shown while on, cleared when off. */
export const WA_FLAG_FIELDS = {
  send_wa: 'wa_form_url',
  wa_enable_catalogue: 'wa_catalogue_url',
  send_app: 'wa_app_url',
  enable_ai: 'ai_key',
} as const;

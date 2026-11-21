/**
 * Why WhatsApp did not deliver a message: Meta's error title (stored in m_status_response by the status webhook)
 * → a short explanation and what to do. Client-safe.
 */

export interface FailureHelp { code: string; meaning: string; action: string }

const HELP: [RegExp, FailureHelp][] = [
  [/stop receiving marketing/i, { code: '131050', meaning: 'The person turned off marketing messages from this business in WhatsApp.', action: 'Do not send marketing templates to this number; Utility / Authentication templates still work.' }],
  [/service temporarily unavailable/i, { code: '131016', meaning: 'WhatsApp was temporarily unavailable.', action: 'Resend (re-queue) the messages later.' }],
  [/something went wrong/i, { code: '131000', meaning: 'An unknown error on WhatsApp\'s side.', action: 'Resend later; if it repeats for many messages, check WhatsApp Manager.' }],
  [/healthy ecosystem engagement/i, { code: '131049', meaning: 'Meta limits how many marketing messages one person receives; this person got enough recently.', action: 'Do not resend today. Send to people who interact with you, or use a Utility template where it fits.' }],
  [/^message undeliverable/i, { code: '131026', meaning: 'The number is not on WhatsApp, uses a very old WhatsApp version, has blocked you, or has not accepted the latest WhatsApp terms.', action: 'Check the number; remove it if it keeps failing.' }],
  [/eligibility payment/i, { code: '131042', meaning: 'The WhatsApp Business Account has a payment problem (no valid card / unpaid invoice / credit line).', action: 'Fix the payment method in Meta Business Settings → WhatsApp accounts → Payment settings.' }],
  [/media upload error/i, { code: '131053', meaning: 'WhatsApp could not download the header image / video / document.', action: 'Use a public https link to a supported file (JPG / PNG ≤ 5 MB, MP4 ≤ 16 MB, PDF ≤ 100 MB).' }],
  [/spam rate limit/i, { code: '131048', meaning: 'Too many recent messages from this number were blocked or reported by recipients.', action: 'Pause campaigns, improve message quality and send only to people who opted in.' }],
  [/account (is )?locked|business account locked/i, { code: '131031', meaning: 'Meta locked the WhatsApp Business Account (policy violation or verification).', action: 'Check Meta Business Support / WhatsApp Manager for the reason and appeal.' }],
  [/re-?engagement/i, { code: '131047', meaning: 'More than 24 hours since the customer last wrote: only a template can be sent.', action: 'Send an approved template instead of a free-form message.' }],
  [/pair rate limit/i, { code: '131056', meaning: 'Too many messages to the same number in a short time.', action: 'Wait before sending to this number again.' }],
  [/rate limit/i, { code: '130429', meaning: 'The number sent faster than its WhatsApp throughput allows.', action: 'Lower Settings → Sending Limits (messages per minute).' }],
  [/experiment/i, { code: '130472', meaning: 'The person is in a Meta experiment that blocks marketing messages.', action: 'Nothing to fix; do not resend.' }],
  [/template.*(paused|disabled)|(paused|disabled).*template/i, { code: '132015', meaning: 'The template was paused or disabled by Meta for low quality.', action: 'Edit / replace the template and sync templates.' }],
  [/template.*(not exist|does not exist|name)/i, { code: '132001', meaning: 'The template (or its language) does not exist on this WhatsApp account.', action: 'Sync templates and check the template name and language.' }],
  [/parameter|format/i, { code: '132000', meaning: 'The variable values do not match the template ({{n}} count or format).', action: 'Check the values sent for each variable.' }],
  [/recipient.*(not|isn)|not a valid whatsapp/i, { code: '131026', meaning: 'The number is not a valid WhatsApp user.', action: 'Check the number.' }],
  [/payment|credit/i, { code: '131042', meaning: 'Billing problem on the WhatsApp Business Account.', action: 'Check the payment settings in Meta Business Settings.' }],
  [/expired|timeout|ttl/i, { code: '131055', meaning: 'The message could not be delivered in time (the phone was off for too long).', action: 'Resend later if still relevant.' }],
];

/** Explanation of a failure reason, or null when it is unknown. */
export function failureHelp(reason: string | null | undefined): FailureHelp | null {
  const r = String(reason ?? '').trim();
  if (!r) return null;
  return HELP.find(([re]) => re.test(r))?.[1] ?? null;
}

/** Shown when no reason was stored (older messages). */
export const NO_REASON = '(no reason recorded)';

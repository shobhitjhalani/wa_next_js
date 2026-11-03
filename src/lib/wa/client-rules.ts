// Client-specific special cases that were hard-coded inside the PHP send functions.
// Kept together here so they are visible and easy to change.

/** Template names that were renamed on Meta after messages were already queued. */
const TEMPLATE_RENAMES: Record<string, string> = {
  west_ev_nov: "west_nov_ex",
  jaipur_march_campaign: "jaipur_marchcampaign",
};

export function templateName(name: string, opts: { flow?: boolean } = {}): string {
  // The flow branch only ever applied the west_ev_nov rename.
  if (opts.flow) return name === "west_ev_nov" ? "west_nov_ex" : name;
  return TEMPLATE_RENAMES[name] ?? name;
}

/** Template language. `templateVariant` = the fun_send_whatsapp_template code path. */
export function templateLanguage(name: string, userId: number, templateVariant: boolean): string {
  if (name === "jaipur_giftcard") return "hi";
  if (name === "lost_customer" && userId === 22) return "en_US";
  if (templateVariant && name === "call_permission" && userId === 48) return "en_US";
  return "en";
}

/** Users whose template parameters are separated by "|" instead of ",". */
export const templateParamSeparator = (userId: number) => (userId === 31 || userId === 13 ? "|" : ",");

/** Flow button index (post_delivery_feedback for user 25 uses the third button). */
export const flowButtonIndex = (name: string, userId: number) =>
  name === "post_delivery_feedback" && userId === 25 ? "2" : "0";

/** Templates whose PDF header is converted to an image before sending. */
export const PDF_TO_IMAGE_TEMPLATES = new Set(["25_08_quad_certificate"]);
export const PDF_TO_IMAGE_SERVICE = "https://pdf2image.myisoft.com";

// --- Catalogue / product list (only implemented for user 11, TGMA Accessories) ---

export const CATALOGUE_USER_ID = 11;

const ICE_MODELS = ["Safari", "Curvv", "Harrier", "Nexon", "Punch", "Tiago", "Tigor", "Altroz"].map((m) => `${m} Accessories`);
const EV_MODELS = ["Curvv.ev", "Harrier.ev", "Nexon.ev", "Punch.ev"].map((m) => `${m} Accessories`);

/** Catalogue keywords to load for a requested model title. */
export function catalogueKeywords(title: string): string[] {
  const keywords = [title, "Universal"];
  if (ICE_MODELS.includes(title)) keywords.push("Common");
  else if (EV_MODELS.includes(title)) keywords.push("Common EV");
  return keywords;
}

export const CATALOGUE_TEXT = {
  catalogue: {
    body:
      "Thank you for showing interest in Genuine TMGA Accessories. Please go through the accessories catalogue and place your order at your convenience.\n\n\n\n*Note: Prices may vary, and accessories are subject to availability.*\n\nT & C Applied.",
    footer: "Regards\n\nTGMA Accessories",
  },
  product_list: {
    body:
      "Thank you for showing interest in Genuine TMGA Accessories. 🙏\n\nPlease explore our accessories catalogue and select the items you’re interested in — *no payment is required at this stage*.\n\n*Our team will connect with you to confirm availability and pricing before finalizing your order*.\nRegards\nTGMA Accessories",
    footer: "T & C Applied.",
  },
} as const;

// --- Inbound webhooks (waapi/webhook.php, waapi/wawebhook.php) ---

/** Raw Meta payloads of users with u_send_app = 1 are forwarded. These users go to their own
 *  u_wa_app_url; everyone else (in webhook.php) goes to Digitomation. */
export const OWN_APP_URL_USERS = [48, 88];
export const DIGITOMATION_INBOUND_URL = "https://app.digitomation.com/webhooks/whatsapp/inbound";

/** Incoming text that opts the sender out (fun_incoming_msg). */
export const OPT_OUT_WORDS = ["stop", "opt out", "stop promotion", "stop promotions"];

/** User 11 (TGMA): replying with a model name triggers a product list auto-reply. */
export const ACCESSORY_KEYWORDS = [
  "Safari Accessories", "Harrier Accessories", "Curvv Accessories", "Nexon Accessories", "Punch Accessories",
  "Altroz Accessories", "Tiago Accessories", "Tigor Accessories", "Curvv.ev Accessories", "Harrier.ev Accessories",
  "Nexon.ev Accessories", "Punch.ev Accessories",
];

/** wawebhook.php: user 25's Sales PSF flow answers go to a Google Apps Script instead of u_wa_form_url. */
export function psfFormOverride(userId: number, response: Record<string, unknown> | null) {
  if (userId === 25 && response && "screen_0_Select_all_that_apply_0" in response) {
    return {
      entryType: "2",
      content: "Sales PSF Response",
      formUrl:
        "https://script.google.com/macros/s/AKfycbwclQgZNXMZBCx3OwQgxVbXZYysX4REHbl4ZATBsbhmpVUoVpcjFqUpR6Iv4smHDDFFAA/exec",
    };
  }
  return null;
}

// --- Report e-mails (cron/email.php, cron/user_email.php) ---

export const REPORT_ADMIN_EMAIL = "admin@jscoretech.com";
/** Users that get the daily per-template report (user_email.php ran it for 46). */
export const TEMPLATE_REPORT_USERS = [46];
export const TEMPLATE_REPORT_BCC = { email: "shobhit@jscoretech.com", name: "Shobhit Jhalani" };
export const TEMPLATE_REPORT_CC: Record<number, { email: string; name: string }> = {
  11: { email: "mohit.sharma2@tatamotors.com", name: "Mohit Sharma" },
};

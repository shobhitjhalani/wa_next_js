// Google Sheets add-on and "JS Data Extractor" licence endpoints.
// Ports of CrmApi::fun_register_sheet(), fun_sheet_status(), fun_check/activate/deactivate_js_data_extractor().
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { entities } from "./legacy";

/** fun_get_user_id(): active e-mail registered for the Sheets add-on. */
const userEmail = (email: string) =>
  db.js_user_emails.findFirst({ where: { ue_dstatus: 0, ue_status: 1, ue_email_id: email } });

const activeSheet = (sheetId: string) =>
  db.js_user_active_sheets.findFirst({ where: { us_status: 1, us_dstatus: 0, us_sheet_id: sheetId } });

/** PHP mixed int and string statuses; kept as-is because clients may compare them strictly. */
export async function registerSheet(p: Record<string, string>) {
  let status: number | string = 0;
  let msg = "Invalid Email ID";
  const ue = await userEmail(p.userEmail ?? "");
  const sheetId = p.sheetId ?? "";
  if (ue && ue.ue_user_id > 0 && sheetId !== "") {
    if (await activeSheet(sheetId)) {
      status = 1;
      msg = "Sheet Already Active";
    } else {
      const row = await db.js_user_active_sheets
        .create({
          data: {
            us_sheet_id: entities(sheetId.trim()),
            us_user_id: ue.ue_user_id,
            us_user_email_id: ue.ue_id,
            us_sheet_type: Number.parseInt(p.sheetType ?? "", 10) || 0,
            us_valid_till: now() + 365 * 86400,
            us_created_on: now(),
            us_status: 1,
          },
        })
        .catch(() => null);
      status = row ? "1" : "0";
      msg = row ? "Sheet Successfully Activated" : "Unable to Activate Sheet";
    }
  }
  return { status, msg, data: [] as unknown[] };
}

export async function sheetStatus(p: Record<string, string>) {
  let status = 0;
  let msg = "Sheet Not Active";
  let email = "";
  const ue = await userEmail(p.userEmail ?? "");
  if (ue && ue.ue_user_id > 0) {
    const sheet = await activeSheet(p.sheetId ?? "");
    if (sheet) {
      status = 1;
      msg = "Sheet is Active";
      const owner = await db.js_user_emails.findUnique({ where: { ue_id: sheet.us_user_email_id } });
      email = owner?.ue_email_id ?? "";
    }
  } else {
    msg = "Invalid Email ID";
  }
  return { status, msg, data: { user_email: email } };
}

const extractorKey = (key: string, extra: { dek_is_login?: number } = {}) =>
  db.js_user_data_extractor_keys.findFirst({ where: { dek_dstatus: 0, dek_status: 1, dek_key: key, ...extra } });

/**
 * check_js_de. PHP compared with `=` (assignment), so every valid key answered "OK"
 * whether logged in or not; kept, since the desktop app relies on it.
 */
export async function checkDataExtractor(key: string) {
  return (await extractorKey(key)) ? "OK" : "Invalid Activation Key";
}

export async function activateDataExtractor(key: string) {
  const row = await extractorKey(key);
  if (!row) return "Invalid Activation Key";
  if (row.dek_is_login === 1) return "Activation Key Already Login";
  const updated = await db.js_user_data_extractor_keys.updateMany({
    where: { dek_key: key },
    data: { dek_is_login: 1, dek_last_login: now() },
  });
  return updated.count > 0 ? "OK" : "";
}

/** deactivate_js_de: PHP printed nothing on success. */
export async function deactivateDataExtractor(key: string) {
  if (!(await extractorKey(key, { dek_is_login: 1 }))) return "Invalid Activation Key";
  await db.js_user_data_extractor_keys.updateMany({ where: { dek_key: key }, data: { dek_is_login: 0, dek_last_login: 0 } });
  return "";
}

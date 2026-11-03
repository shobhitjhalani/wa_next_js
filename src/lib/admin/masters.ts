import "server-only";
import { db } from "@/lib/db";

export type Heading = { id: number; name: string; code: string };

/**
 * js_master_heading is missing from the migrated wa_official copy (it exists in the
 * related wa_js database). These are its rows, used when the table is absent so the
 * Data Masters menu still works; once the production dump brings the table, it wins.
 */
const FALLBACK_HEADINGS: Heading[] = [
  { id: 2, name: "Custom Fields", code: "cf" },
  { id: 3, name: "Field Set", code: "as" },
  { id: 42, name: "Country", code: "country" },
  { id: 43, name: "State", code: "states" },
  { id: 44, name: "City", code: "city" },
  { id: 48, name: "Bank Name", code: "bn" },
  { id: 52, name: "Banner Position", code: "bp" },
  { id: 53, name: "Page Position", code: "pp" },
  { id: 56, name: "FAQ Category", code: "faq_category" },
  { id: 57, name: "FAQ", code: "faq" },
  { id: 82, name: "WhatsApp Plan Type", code: "wpt" },
  { id: 94, name: "User Type", code: "ut" },
  { id: 95, name: "Payment Gateway", code: "pg" },
  { id: 96, name: "Google Sheets Type", code: "sht" },
  { id: 97, name: "Numbers", code: "no" },
  { id: 98, name: "Documents", code: "documents" },
  { id: 99, name: "Vehicle Master", code: "vehicle" },
  { id: 100, name: "Location Master", code: "location" },
  { id: 101, name: "Team Role", code: "team_role" },
  { id: 102, name: "Team", code: "team" },
  { id: 103, name: "Master Value", code: "masters" },
  { id: 104, name: "Cron Jobs", code: "cron" },
];

export async function masterHeadings(): Promise<Heading[]> {
  try {
    return await db.$queryRaw<Heading[]>`
      SELECT mh_id AS id, mh_name AS name, mh_code AS code FROM js_master_heading WHERE mh_status = 2 ORDER BY mh_name`;
  } catch {
    return [...FALLBACK_HEADINGS].sort((a, b) => a.name.localeCompare(b.name));
  }
}

export async function heading(id: number): Promise<Heading | undefined> {
  return (await masterHeadings()).find((h) => h.id === id);
}

export type MasterField = "mv_name" | "mv_code" | "mv_desc" | "mv_value" | "mv_value1" | "mv_value2" | "mv_value3" | "mv_value4" | "mv_value_decimal" | "mv_display_order";

/** Columns shown in the list and fields in the form, by heading (index.php $hd1..$hd5 / add.php). */
export function masterLayout(type: number): { columns: { label: string; field: MasterField; lookup?: boolean }[]; form: { label: string; field: MasterField }[] } {
  switch (type) {
    case 82: // WhatsApp plans: mv_value = validity days, mv_value1 = plan type, decimal = amount
      return {
        columns: [{ label: "Title", field: "mv_name" }, { label: "Validity (in Days)", field: "mv_value" }, { label: "Amount", field: "mv_value_decimal" }],
        form: [
          { label: "Title", field: "mv_name" },
          { label: "Validity (in Days)", field: "mv_value" },
          { label: "Plan Type (1 Incoming, 2 Paid, 3 Trial)", field: "mv_value1" },
          { label: "Amount", field: "mv_value_decimal" },
          { label: "Display Order", field: "mv_display_order" },
        ],
      };
    case 43: // State: mv_value = country id
      return {
        columns: [{ label: "Title", field: "mv_name" }, { label: "Country", field: "mv_value", lookup: true }],
        form: [{ label: "Title", field: "mv_name" }, { label: "Code", field: "mv_code" }, { label: "Country (id)", field: "mv_value" }],
      };
    case 44: // City: mv_value1 = state id
      return {
        columns: [{ label: "Title", field: "mv_name" }, { label: "State", field: "mv_value1", lookup: true }],
        form: [{ label: "Title", field: "mv_name" }, { label: "Code", field: "mv_code" }, { label: "State (id)", field: "mv_value1" }],
      };
    case 104: // Cron jobs (send_whatsapp.php lanes): desc = parent ids, value1/2 = start/end, value3 = state, value4 = sent
      return {
        columns: [
          { label: "Title", field: "mv_name" },
          { label: "Desc", field: "mv_desc" },
          { label: "Start Time", field: "mv_value1" },
          { label: "End Time", field: "mv_value2" },
          { label: "Status", field: "mv_value3" },
          { label: "Msg Send", field: "mv_value4" },
        ],
        form: [{ label: "Title", field: "mv_name" }, { label: "Parent User IDs (comma separated)", field: "mv_desc" }, { label: "Status (completed / running)", field: "mv_value3" }],
      };
    case 98: // Documents
      return {
        columns: [{ label: "Title", field: "mv_name" }, { label: "User", field: "mv_value" }, { label: "File", field: "mv_desc" }],
        form: [{ label: "Title", field: "mv_name" }, { label: "User (id)", field: "mv_value" }, { label: "Description", field: "mv_desc" }],
      };
    default:
      return {
        columns: [{ label: "Title", field: "mv_name" }, { label: "Code", field: "mv_code" }, { label: "Description", field: "mv_desc" }],
        form: [
          { label: "Title", field: "mv_name" },
          { label: "Code", field: "mv_code" },
          { label: "Description", field: "mv_desc" },
          { label: "Value", field: "mv_value" },
          { label: "Display Order", field: "mv_display_order" },
        ],
      };
  }
}

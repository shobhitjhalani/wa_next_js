import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { assignedMessageFilter, type Admin } from "./guard";
import { dateRange } from "./format";
import { int, str, type SearchParams } from "./params";

export type ReportKey = "wa_send" | "wa_failed" | "wa_error" | "wa_system_error" | "wa_que" | "wa_in_process" | "error";

export type BulkAction = { value: string; label: string; data: () => Prisma.js_messageUpdateManyMutationInput };

const del: BulkAction = { value: "1", label: "Delete", data: () => ({ m_dstatus: 1, m_updated_on: now() }) };
const resend: BulkAction = {
  value: "2",
  label: "Resend",
  data: () => ({ m_status: 1, m_delivery_status: "", m_error_codes: "", m_status_response: "", m_updated_on: now() }),
};

/** The six wamaster/view/reports/wa_*.php pages differ only in these settings. */
export const REPORTS: Record<
  ReportKey,
  {
    title: string;
    superOnly: boolean;
    base: Prisma.js_messageWhereInput;
    actions: BulkAction[];
    /** wa_send has its own filter set (date type, message type, delivery/status filters, export). */
    full?: boolean;
    dateColumn: "m_created_on" | "m_in_process_on";
  }
> = {
  wa_send: { title: "WA Report", superOnly: false, base: {}, actions: [del, resend], full: true, dateColumn: "m_created_on" },
  wa_failed: {
    title: "WA Failed Report",
    superOnly: true,
    base: { m_status: { not: 1 }, m_delivery_status: "failed" },
    actions: [
      del,
      { ...resend, data: () => ({ ...resend.data(), m_created_on: now() }) },
      { value: "3", label: "Invalid Mobile No", data: () => ({ m_status: 7, m_delivery_status: "error" }) },
    ],
    dateColumn: "m_created_on",
  },
  wa_error: {
    title: "WA Error Report",
    superOnly: true,
    base: { OR: [{ m_status: 3, m_message_id: "" }, { m_status: 4 }] },
    actions: [del, resend],
    dateColumn: "m_created_on",
  },
  wa_system_error: {
    title: "WA Error Report",
    superOnly: true,
    base: { m_status: 4, m_message_id: "" },
    actions: [del, resend],
    dateColumn: "m_created_on",
  },
  wa_que: { title: "WA In Que Report", superOnly: false, base: { m_status: 1 }, actions: [del], dateColumn: "m_created_on" },
  wa_in_process: {
    title: "WA In Process Report",
    superOnly: true,
    base: { m_status: 6 },
    actions: [
      del,
      { value: "2", label: "Back to Que", data: () => ({ m_status: 1, m_delivery_status: "", m_error_codes: "", m_status_response: "" }) },
      { value: "3", label: "Mark as Send", data: () => ({ m_status: 3, m_delivery_status: "sent", m_error_codes: "", m_status_response: "" }) },
    ],
    dateColumn: "m_created_on",
  },
  // reports/error.php: invalid mobile numbers. PHP also required the legacy m_msg_type = '1'
  // and m_source, which no current message has, so the page was always empty.
  error: { title: "InValid Mobile No.", superOnly: true, base: { m_status: 7 }, actions: [del, resend], dateColumn: "m_created_on" },
};

const TEMPLATE_TYPES = ["template", "flow", "catalogue", "product_list"];

type DateColumn = "m_created_on" | "m_updated_on" | "m_in_process_on";

/** The column the report's date filter applies to, or null when no date range is set. */
export function reportDateColumn(key: ReportKey, sp: SearchParams): DateColumn | null {
  if (!dateRange(str(sp, "wa_date"))) return null;
  const r = REPORTS[key];
  if (!r.full) return r.dateColumn;
  return ({ "2": "m_updated_on", "3": "m_in_process_on" } as Record<string, DateColumn>)[str(sp, "date_type")] ?? "m_created_on";
}

/**
 * Newest first. With a date range, sort by that column so Postgres reads the range
 * from its index instead of walking m_id backwards past every newer message.
 */
export function reportOrderBy(key: ReportKey, sp: SearchParams): Prisma.js_messageOrderByWithRelationInput[] {
  const col = reportDateColumn(key, sp);
  return col ? [{ [col]: "desc" }, { m_id: "desc" }] : [{ m_id: "desc" }];
}

/** Builds the WHERE for a report from its base + the URL filters (PHP $con / $dtcon / $status_con). */
export function reportWhere(key: ReportKey, admin: Admin, sp: SearchParams): Prisma.js_messageWhereInput {
  const r = REPORTS[key];
  const and: Prisma.js_messageWhereInput[] = [{ m_is_incoming: 2, m_dstatus: 0 }, r.base, assignedMessageFilter(admin)];

  const col = reportDateColumn(key, sp);
  if (col) and.push({ [col]: dateRange(str(sp, "wa_date"))! });
  const userId = int(sp, "user_id");
  if (userId) and.push({ m_user_id: userId });
  const mobile = str(sp, "mobile_no");
  if (mobile) and.push({ m_mobile_no: mobile });
  const sheet = str(sp, "sheet_id");
  if (sheet) and.push({ m_sheet_id: { contains: sheet } });

  if (r.full) {
    const t = str(sp, "msg_type");
    if (t === "1") and.push({ m_msg_type: { in: TEMPLATE_TYPES } });
    else if (t === "2") and.push({ OR: [{ m_msg_type: { notIn: TEMPLATE_TYPES } }, { m_msg_type: null }] });
    else if (t && t !== "3") and.push({ m_msg_type: t });
    const dst = str(sp, "dst");
    if (dst) and.push({ m_delivery_status: dst });
    const st = int(sp, "st");
    if (st) and.push({ m_status: st });
  } else {
    const tpl = str(sp, "template");
    if (tpl === "-1") and.push({ m_msg_template_name: null });
    else if (tpl) and.push({ m_msg_template_name: tpl });
  }
  return { AND: and };
}

export const REPORT_SELECT = {
  m_id: true, m_updated_on: true, m_title: true, m_content: true, m_mobile_no: true, m_response_file_name: true,
  m_created_on: true, m_in_process_on: true, m_status: true, m_msg_template_name: true, m_msg_template_para: true,
  m_user_id: true, m_delivery_status: true, m_message_id: true, m_status_response: true, m_error_codes: true,
  m_msg_type: true, m_image: true, js_user: { select: { u_username: true } },
} satisfies Prisma.js_messageSelect;

/** Header counters of wa_send.php. Uses the same filters, without the user-assignment join for speed when super admin. */
export async function sendReportCounters(where: Prisma.js_messageWhereInput) {
  const [sent, templates, error, pending] = await Promise.all([
    db.js_message.count({ where: { AND: [where, { m_status: 3, m_message_id: { not: "" } }] } }),
    db.js_message.count({ where: { AND: [where, { m_status: 3, m_message_id: { not: "" }, m_msg_type: "template" }] } }),
    db.js_message.count({ where: { AND: [where, { m_status: 3, m_message_id: "" }] } }),
    db.js_message.count({ where: { AND: [where, { m_status: 1 }] } }),
  ]);
  return { sent, templates, error, pending };
}

/** Applies a bulk action to messages the admin is allowed to see. */
export async function applyBulkAction(admin: Admin, key: ReportKey, action: string, ids: bigint[]) {
  const a = REPORTS[key].actions.find((x) => x.value === action);
  if (!a || ids.length === 0) return 0;
  const res = await db.js_message.updateMany({
    where: { m_id: { in: ids }, m_is_incoming: 2, ...assignedMessageFilter(admin) },
    data: a.data(),
  });
  return res.count;
}

/** "Content" column text: content, or "<Type> : <template>" + parameters. */
export function messageSummary(m: { m_content: string | null; m_msg_type: string | null; m_title: string | null; m_msg_template_name: string | null; m_msg_template_para: string | null }) {
  let text = m.m_content ?? "";
  if (!text) {
    if (m.m_msg_type === "product_list") text = `Product List : ${m.m_title ?? ""}`;
    else text = `${(m.m_msg_type ?? "").charAt(0).toUpperCase()}${(m.m_msg_type ?? "").slice(1)} : ${m.m_msg_template_name ?? ""}`;
    if (m.m_msg_template_para) text += `\nParameter: ${m.m_msg_template_para}`;
  }
  return text;
}

/** Error text for failed messages: m_status_response, else the first error title in m_error_codes JSON. */
export function messageError(m: { m_status_response: string | null; m_error_codes: string | null }) {
  if (m.m_status_response) return m.m_status_response;
  try {
    const raw = (m.m_error_codes ?? "").replace(/&#34;/g, '"').replace(/&#39;/g, "'");
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return [first?.code, first?.title ?? first?.message].filter(Boolean).join(" : ");
  } catch {
    return m.m_error_codes ?? "";
  }
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { dateRange, PAGE_SIZE, todayDmy } from "./format";

// Query side of que.php, reports*.php, incoming*.php. Every query is scoped to the
// signed-in user; the PHP built these from raw request values.

export type ListKind = "que" | "reports" | "failed" | "error" | "incoming" | "attachments";

export type Filters = {
  wa_date: string;
  mobile_no: string;
  msg_type: string; // reports: 1 template, 2 replies
  del_status: string; // reports
  template: string; // failed
  read_status: string; // incoming: -1 all, 1 read, 2 unread
  content: string; // incoming
};

/** Filters from the query string. `s=false` (menu link) = fresh page: today's date. */
export function readFilters(sp: Record<string, string | string[] | undefined>, kind: ListKind): Filters {
  const g = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  const isIncoming = kind === "incoming" || kind === "attachments";
  const submitted = "wa_date" in sp;
  return {
    // The PHP incoming pages default to no date, the others to today.
    wa_date: submitted ? g("wa_date") : isIncoming ? "" : todayDmy(),
    mobile_no: g("mobile_no"),
    msg_type: g("msg_type"),
    del_status: g("del_status"),
    template: g("template"),
    read_status: "read_status" in sp ? g("read_status") : "2",
    content: g("content"),
  };
}

export function filtersQuery(f: Filters): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
}

function where(userId: number, kind: ListKind, f: Filters): Prisma.js_messageWhereInput {
  const w: Prisma.js_messageWhereInput = { m_user_id: userId, m_dstatus: 0 };
  const range = dateRange(f.wa_date);
  if (range) w.m_created_on = range;
  if (f.mobile_no) w.m_mobile_no = f.mobile_no;

  switch (kind) {
    case "que":
      Object.assign(w, { m_is_incoming: 2, m_status: { in: [1, 6] } });
      break;
    case "reports":
      w.m_is_incoming = 2;
      if (f.del_status) w.m_delivery_status = f.del_status;
      if (f.msg_type === "1") w.m_msg_type = "template";
      else if (f.msg_type === "2") w.m_msg_type = { not: "template" };
      break;
    case "failed":
      Object.assign(w, { m_is_incoming: 2, m_delivery_status: "failed" });
      if (f.template) w.m_msg_template_name = f.template;
      break;
    case "error":
      Object.assign(w, { m_is_incoming: 2, m_status: 3, m_message_id: "" });
      break;
    case "incoming":
    case "attachments":
      w.m_is_incoming = 1;
      if (kind === "attachments") w.m_msg_type = { in: ["image", "document", "video", "audio"] };
      if (f.read_status && f.read_status !== "-1") w.m_is_read = Number(f.read_status);
      if (f.content) w.m_content = { contains: f.content };
      break;
  }
  return w;
}

export async function listMessages(userId: number, kind: ListKind, f: Filters, page: number) {
  const w = where(userId, kind, f);
  const [total, rows] = await Promise.all([
    db.js_message.count({ where: w }),
    db.js_message.findMany({
      where: w,
      orderBy: { m_id: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        m_id: true, m_title: true, m_content: true, m_mobile_no: true, m_response_file_name: true,
        m_created_on: true, m_updated_on: true, m_status: true, m_msg_template_name: true,
        m_msg_template_para: true, m_delivery_status: true, m_message_id: true, m_status_response: true,
        m_image: true, m_msg_type: true, m_sender_name: true, m_sheet_id: true, m_error_codes: true,
      },
    }),
  ]);
  return { rows, total, pages: Math.ceil(total / PAGE_SIZE), offset: (page - 1) * PAGE_SIZE };
}

/** For exports: same filters, no paging (fun_download_messages). */
export async function allMessages(userId: number, kind: "reports" | "error" | "failed", f: Filters) {
  const w = where(userId, kind, kind === "error" ? f : { ...f, msg_type: "" });
  if (kind === "error") w.m_msg_type = "template";
  return db.js_message.findMany({ where: w, orderBy: { m_id: "desc" }, take: 100_000 });
}

export function userTemplateNames(userId: number) {
  return db.js_user_templates.findMany({
    where: { ut_user_id: userId, ut_dstatus: 0 },
    orderBy: { ut_id: "desc" },
    select: { ut_id: true, ut_name: true },
  });
}

const ids = (mids: (string | number | bigint)[]) =>
  mids.map((m) => {
    try {
      return BigInt(m);
    } catch {
      return null;
    }
  }).filter((m): m is bigint => m !== null);

/** reports_failed.php / reports_error.php "Change" button. */
export async function changeStatus(userId: number, kind: "failed" | "error", cstatus: string, mids: string[]) {
  const where = { m_user_id: userId, m_id: { in: ids(mids) } };
  if (!where.m_id.in.length) return 0;
  const t = now();
  if (cstatus === "1") return (await db.js_message.updateMany({ where, data: { m_dstatus: 1, m_updated_on: t } })).count;
  if (cstatus === "2") {
    const data: Prisma.js_messageUpdateManyMutationInput =
      kind === "failed"
        ? { m_status: 1, m_delivery_status: "", m_error_codes: "", m_status_response: "", m_created_on: t, m_updated_on: t }
        : { m_status: 1, m_updated_on: t };
    return (await db.js_message.updateMany({ where, data })).count;
  }
  if (cstatus === "3" && kind === "failed") {
    return (await db.js_message.updateMany({ where, data: { m_status: 7, m_delivery_status: "error" } })).count;
  }
  return 0;
}

/** incoming.php "Change": mark read (1) / unread (2). PHP did not check the owner. */
export async function markRead(userId: number, cstatus: string, mids: string[]) {
  if (cstatus !== "1" && cstatus !== "2") return 0;
  return (
    await db.js_message.updateMany({
      where: { m_user_id: userId, m_is_incoming: 1, m_id: { in: ids(mids) } },
      data: { m_is_read: Number(cstatus) },
    })
  ).count;
}

/** que.php "Cancel All": hides queued / processing messages. */
export async function cancelAllQueued(userId: number) {
  return (
    await db.js_message.updateMany({
      where: { m_user_id: userId, m_is_incoming: 2, m_status: { in: [1, 6] } },
      data: { m_dstatus: 1 },
    })
  ).count;
}

/**
 * reports_templates.php: per-template counts. Sent/delivered/read (and blank) are
 * merged into one column; queued and "error" (sent without a message id) are added.
 */
export async function templateSummary(userId: number, f: Filters, queSince: number) {
  const range = dateRange(f.wa_date);
  const base: Prisma.js_messageWhereInput = {
    m_user_id: userId,
    m_is_incoming: 2,
    m_dstatus: 0,
    ...(range ? { m_created_on: range } : {}),
    ...(f.mobile_no ? { m_mobile_no: f.mobile_no } : {}),
    ...(f.template ? { m_msg_template_name: f.template } : {}),
    ...(f.del_status ? { m_delivery_status: f.del_status } : {}),
  };
  const types = { m_msg_type: { in: ["template", "flow", "catalogue"] } };
  const [sent, que, error] = await Promise.all([
    db.js_message.groupBy({
      by: ["m_msg_template_name", "m_delivery_status"],
      where: { ...base, ...types, m_status: 3, m_message_id: { not: "" } },
      _count: { _all: true },
    }),
    db.js_message.groupBy({
      by: ["m_msg_template_name", "m_delivery_status"],
      where: { m_user_id: userId, m_is_incoming: 2, m_dstatus: 0, m_status: 1, m_created_on: { gte: queSince } },
      _count: { _all: true },
    }),
    db.js_message.groupBy({
      by: ["m_msg_template_name", "m_delivery_status"],
      where: { ...base, ...types, m_status: 3, m_message_id: "" },
      _count: { _all: true },
    }),
  ]);
  const SDR = "Send / Delivered / Read";
  const data = new Map<string, Record<string, number>>();
  const headings = new Set<string>();
  const add = (t: string | null, col: string, n: number) => {
    const k = t ?? "";
    const row = data.get(k) ?? {};
    row[col] = (row[col] ?? 0) + n;
    data.set(k, row);
  };
  for (const g of sent) {
    const st = !g.m_delivery_status || ["delivered", "sent", "read"].includes(g.m_delivery_status) ? SDR : g.m_delivery_status;
    headings.add(st);
    add(g.m_msg_template_name, st, g._count._all);
  }
  for (const g of que) add(g.m_msg_template_name, "Que", g._count._all);
  for (const g of error) add(g.m_msg_template_name, "Error", g._count._all);
  return { headings: [...[...headings].sort(), "Que", "Error"], rows: [...data.entries()] };
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { assignedMessageFilter, type Admin } from "./guard";
import { F_YEAR } from "./constants";

const outgoing = { m_is_incoming: 2, m_dstatus: 0 } as const;

function monthStart(offsetMonths = 0): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" })
    .formatToParts(new Date()).reduce<Record<string, string>>((a, x) => ((a[x.type] = x.value), a), {});
  const d = new Date(Date.UTC(+p.year, +p.month - 1 + offsetMonths, 1));
  return Math.floor(d.getTime() / 1000) - 5.5 * 3600;
}

async function rechargeTotal(extra: Prisma.js_user_rechargeWhereInput) {
  const r = await db.js_user_recharge.aggregate({
    where: { ur_dstatus: 0, ur_year: F_YEAR, ur_generate_invoice: 1, ...extra },
    _sum: { ur_amount: true },
    _count: { ur_id: true },
  });
  return { amount: Number(r._sum.ur_amount ?? 0), count: r._count.ur_id };
}

/** Numbers for the top of wamaster/dashboard.php. */
export async function dashboardStats() {
  const today = istParts().startOfDay;
  const queDate = today - 518_400; // PHP: 6 days ("3 Days" comment)
  const thisMonth = monthStart(0);
  const lastMonth = monthStart(-1);
  const nextMonth = monthStart(1);

  const [year, month, last, pendingRecharge, pending, inProcessRecent, inProcessAll, totalRecent, connected, lastSent, sentToday] =
    await Promise.all([
      rechargeTotal({}),
      rechargeTotal({ ur_created_on: { gte: thisMonth } }),
      // PHP: from 1st of last month to the end of last month's last day (+1 day).
      rechargeTotal({ ur_created_on: { gte: lastMonth, lte: thisMonth } }),
      db.js_user.count({ where: { u_dstatus: 0, u_type: 2, u_valid_till: { gte: thisMonth, lt: nextMonth } } }),
      db.js_message.count({ where: { ...outgoing, m_status: 1, m_created_on: { gte: queDate } } }),
      db.js_message.count({ where: { ...outgoing, m_status: 6, m_created_on: { gte: queDate } } }),
      db.js_message.count({ where: { ...outgoing, m_status: 6 } }),
      db.js_message.count({ where: { ...outgoing, m_created_on: { gte: queDate } } }),
      db.js_user.count({ where: { u_wa_plan_status: 1, u_type: 2, u_wa_status: 1, u_dstatus: 0, u_status: 1 } }),
      db.js_message.findFirst({
        where: { ...outgoing, m_status: 3, m_updated_on: { gt: 0 } },
        orderBy: { m_updated_on: "desc" },
        select: { m_updated_on: true },
      }),
      db.js_message.count({
        where: { ...outgoing, m_status: 3, m_delivery_status: { in: ["read", "sent", "delivered"] }, m_updated_on: { gte: today } },
      }),
    ]);

  return {
    year, month, last, pendingRecharge, pending, inProcessRecent, inProcessAll, totalRecent, connected,
    pendingPercent: totalRecent ? Math.round((pending / totalRecent) * 100) : 0,
    lastSent: lastSent?.m_updated_on ?? 0,
    sentToday,
  };
}

/** Corporate users grouped by state ("User by State"). */
export async function usersByState() {
  const where = { u_dstatus: 0, u_type: 1, u_status: 1 };
  const [total, groups] = await Promise.all([
    db.js_user.count({ where }),
    db.js_user.groupBy({ by: ["u_state"], where, _count: { u_id: true } }),
  ]);
  const names = await db.js_master_value.findMany({
    where: { mv_id: { in: groups.map((g) => BigInt(g.u_state)) } },
    select: { mv_id: true, mv_name: true },
  });
  const nameOf = new Map(names.map((n) => [Number(n.mv_id), n.mv_name ?? ""]));
  return groups.map((g) => ({
    state: nameOf.get(g.u_state) ?? "",
    count: g._count.u_id,
    percent: total ? Math.round((g._count.u_id / total) * 100) : 0,
  }));
}

export type UserSummaryRow = { userId: number; username: string; counts: Record<string, number>; lastSend: number };

/**
 * Per-user message summary by delivery status plus Que / In Process / Error columns
 * (dashboard "Today Summary" and reports/summary.php).
 */
export async function userSummary(opts: {
  admin: Admin;
  sent: Prisma.js_messageWhereInput; // filter for sent messages (m_status 3, m_message_id != '')
  que?: Prisma.js_messageWhereInput;
  inProcess?: Prisma.js_messageWhereInput;
  error?: Prisma.js_messageWhereInput;
  incoming?: Prisma.js_messageWhereInput;
}) {
  const userWhere = assignedMessageFilter(opts.admin);
  const group = (where: Prisma.js_messageWhereInput, by: ("m_user_id" | "m_delivery_status")[]) =>
    db.js_message.groupBy({ by, where: { ...where, ...userWhere }, _count: { m_id: true } });

  const [sent, que, inProcess, error, incoming] = await Promise.all([
    group({ ...outgoing, m_status: 3, m_message_id: { not: "" }, ...opts.sent }, ["m_user_id", "m_delivery_status"]),
    opts.que ? group({ ...outgoing, ...opts.que }, ["m_user_id"]) : Promise.resolve([]),
    opts.inProcess ? group({ ...outgoing, ...opts.inProcess }, ["m_user_id"]) : Promise.resolve([]),
    opts.error ? group({ ...outgoing, ...opts.error }, ["m_user_id"]) : Promise.resolve([]),
    opts.incoming ? group({ m_is_incoming: 1, m_dstatus: 0, ...opts.incoming }, ["m_user_id"]) : Promise.resolve([]),
  ]);

  const rows = new Map<number, Record<string, number>>();
  const add = (uid: number, key: string, n: number) => {
    const r = rows.get(uid) ?? {};
    r[key] = (r[key] ?? 0) + n;
    rows.set(uid, r);
  };
  const statuses = new Set<string>();
  for (const g of sent) {
    const k = (g as { m_delivery_status?: string | null }).m_delivery_status ?? "";
    statuses.add(k);
    add(g.m_user_id, k, g._count.m_id);
  }
  for (const g of que) add(g.m_user_id, "Que", g._count.m_id);
  for (const g of inProcess) add(g.m_user_id, "In Process", g._count.m_id);
  for (const g of error) add(g.m_user_id, "Error", g._count.m_id);
  for (const g of incoming) add(g.m_user_id, "Incoming", g._count.m_id);

  const users = await db.js_user.findMany({
    where: { u_id: { in: [...rows.keys()] } },
    select: { u_id: true, u_username: true, u_last_wa_send: true },
  });
  const byId = new Map(users.map((u) => [u.u_id, u]));

  const headings = [...statuses].sort();
  const extra = [opts.error && "Error", opts.que && "Que", opts.inProcess && "In Process", opts.incoming && "Incoming"].filter(Boolean) as string[];
  const data: UserSummaryRow[] = [...rows.entries()].map(([userId, counts]) => ({
    userId,
    username: byId.get(userId)?.u_username ?? "",
    counts,
    lastSend: byId.get(userId)?.u_last_wa_send ?? 0,
  }));
  return { headings: [...headings, ...extra], rows: data };
}

/** Statuses that count towards "Total Send" (PHP excluded '', Que, In Process, Incoming, failed, Error). */
export const countsAsSent = (k: string) => !["", "Que", "In Process", "Incoming", "failed", "Error"].includes(k);

export { now };

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { int, str, type SearchParams } from "./params";
import { dateRange } from "./format";

const DATE_COL: Record<string, "m_created_on" | "m_updated_on" | "m_in_process_on"> = { "1": "m_created_on", "2": "m_updated_on", "3": "m_in_process_on" };

/** Builds the per user / template / delivery-status matrix of reports/templates.php. */
export async function templateSummary(adminFilter: Prisma.js_messageWhereInput, sp: SearchParams) {
  const range = dateRange(str(sp, "wa_date"));
  const dateCon: Prisma.js_messageWhereInput = range ? { [DATE_COL[str(sp, "date_type")] ?? "m_created_on"]: range } : {};
  let userCon: Prisma.js_messageWhereInput = {};
  const userId = int(sp, "user_id");
  const parentId = int(sp, "parent_id");
  if (parentId) userCon = { m_user_id: { in: (await db.js_user.findMany({ where: { u_parent_id: parentId }, select: { u_id: true } })).map((u) => u.u_id) } };
  else if (userId) userCon = { m_user_id: userId };

  const base = { m_is_incoming: 2, m_dstatus: 0, ...adminFilter, ...userCon };
  const by = ["m_user_id", "m_msg_template_name", "m_delivery_status"] as const;
  const [sent, que, error] = await Promise.all([
    db.js_message.groupBy({ by: [...by], where: { ...base, ...dateCon, m_message_id: { not: "" }, m_msg_type: { in: ["template", "flow", "catalogue"] }, m_status: 3 }, _count: { m_id: true } }),
    // PHP: queued/processing templates are counted regardless of the date filter.
    db.js_message.groupBy({ by: ["m_user_id", "m_msg_template_name"], where: { ...base, m_status: { in: [1, 6] }, m_msg_type: "template" }, _count: { m_id: true } }),
    db.js_message.groupBy({ by: ["m_user_id", "m_msg_template_name"], where: { ...base, ...dateCon, m_message_id: "", m_status: 4, m_msg_type: "template" }, _count: { m_id: true } }),
  ]);

  const data = new Map<string, { userId: number; template: string; counts: Record<string, number> }>();
  const add = (u: number, t: string | null, k: string, n: number) => {
    const key = `${u}|${t ?? ""}`;
    const row = data.get(key) ?? { userId: u, template: t ?? "", counts: {} };
    row.counts[k] = (row.counts[k] ?? 0) + n;
    data.set(key, row);
  };
  const statuses = new Set<string>();
  for (const g of sent) {
    statuses.add(g.m_delivery_status ?? "");
    add(g.m_user_id, g.m_msg_template_name, g.m_delivery_status ?? "", g._count.m_id);
  }
  for (const g of que) add(g.m_user_id, g.m_msg_template_name, "Que", g._count.m_id);
  for (const g of error) add(g.m_user_id, g.m_msg_template_name, "Error", g._count.m_id);
  const rows = [...data.values()].sort((a, b) => a.userId - b.userId);
  return { headings: [...[...statuses].sort(), "Error", "Que"], rows };
}


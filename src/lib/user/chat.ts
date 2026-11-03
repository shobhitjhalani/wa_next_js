import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { now } from "@/lib/config";
import { sendClaimedMessages } from "@/lib/wa/sender";
import { decodeEntities, phpDate, phpEscape } from "./format";

// chat.php / chat_mobile_list.php / chat_message.php / save_msg.php

export type ChatContact = { mobile: string; name: string; last: string; unread: number };

/** Last 100 numbers the user exchanged messages with (optionally filtered). */
export async function chatContacts(userId: number, search: string): Promise<ChatContact[]> {
  const like = `%${search}%`;
  const rows = await db.$queryRaw<{ mobile: string; name: string | null; last: number; unread: bigint }[]>(Prisma.sql`
    SELECT m_mobile_no AS mobile, MAX(m_sender_name) AS name, MAX(m_created_on) AS last,
           COUNT(*) FILTER (WHERE m_is_read = 2 AND m_is_incoming = 1) AS unread
      FROM js_message
     WHERE m_user_id = ${userId} AND m_dstatus = 0 AND m_mobile_no IS NOT NULL
       ${search ? Prisma.sql`AND m_mobile_no LIKE ${like}` : Prisma.empty}
     GROUP BY m_mobile_no
     ORDER BY MAX(m_created_on) DESC
     LIMIT 100`);
  return rows.map((r) => ({ mobile: r.mobile, name: r.name ?? "", last: phpDate("M d, H:i", r.last), unread: Number(r.unread) }));
}

export type ChatMessage = { id: string; mine: boolean; text: string; time: string; tick: "" | "sent" | "delivered" | "read" };

/** One conversation; opening it marks the incoming messages read. */
export async function chatMessages(userId: number, mobile: string) {
  const rows = await db.js_message.findMany({
    where: { m_user_id: userId, m_mobile_no: mobile, m_dstatus: 0 },
    orderBy: { m_created_on: "asc" },
    select: { m_id: true, m_is_incoming: true, m_content: true, m_msg_template_name: true, m_created_on: true, m_delivery_status: true },
  });
  await db.js_message.updateMany({
    where: { m_user_id: userId, m_mobile_no: mobile, m_is_read: 2 },
    data: { m_is_read: 1 },
  });
  let lastIncoming = 0;
  const messages: ChatMessage[] = rows.map((r) => {
    if (r.m_is_incoming === 1) lastIncoming = r.m_created_on;
    const ds = r.m_delivery_status ?? "";
    return {
      id: String(r.m_id),
      mine: r.m_is_incoming === 2,
      text: r.m_content ? decodeEntities(r.m_content) : `Template : ${r.m_msg_template_name ?? ""}`,
      time: phpDate("M d H:i", r.m_created_on),
      tick: r.m_is_incoming !== 2 ? "" : ds === "" ? "sent" : ds === "read" ? "read" : "delivered",
    };
  });
  // Free-form replies are only allowed within 24h of the customer's last message.
  return { messages, canReply: now() - lastIncoming <= 86400 };
}

/** save_msg.php: store a text reply and send it right away. */
export async function sendChatReply(userId: number, mobile: string, msg: string) {
  const m = await db.js_message.create({
    data: {
      m_msg_type: "text",
      m_msg_template_name: "",
      m_title: "",
      m_content: phpEscape(msg),
      m_mobile_no: mobile.trim(),
      m_image: "",
      m_user_id: userId,
      m_sheet_id: "",
      m_status: 6,
      m_source: 2,
      m_created_on: now(),
    },
  });
  await sendClaimedMessages({ msgId: m.m_id, userId, variant: "meta" });
  return m.m_id;
}

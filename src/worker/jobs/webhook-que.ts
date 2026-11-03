// Applies queued delivery statuses (sent/delivered/read/failed) to messages.
// Port of cron/webhook_que.php (wa_status.sh / wa_move.sh).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const BATCH = 1000;

/** Returns how many queued statuses were applied to a message. */
export async function applyWebhookQueue(log: (l: string) => void): Promise<number> {
  const rows = await db.log_js_webhook_que.findMany({
    where: { moved: 1, msg_id: { not: "" } },
    orderBy: { id: "asc" },
    take: BATCH,
  });

  let applied = 0;
  let unmatched = 0;
  for (const q of rows) {
    const msgId = q.msg_id ?? "";
    const status = (q.status ?? "").slice(0, 25);

    const logs = await db.log_js_message_log.updateMany({ where: { ml_wa_id: msgId }, data: { ml_wa_status: status } });

    // PHP: UPDATE ... WHERE m_message_id = ? LIMIT 1
    const updated = await db.$executeRaw(Prisma.sql`
      UPDATE js_message
         SET m_updated_on = ${Math.floor(q.systemtime.getTime() / 1000)},
             m_delivery_status = ${status},
             m_status_response = ${(q.error ?? "").slice(0, 255)}
       WHERE m_id = (SELECT m_id FROM js_message WHERE m_message_id = ${msgId} LIMIT 1)`);

    if (updated > 0) {
      await db.log_js_webhook_que.delete({ where: { id: q.id } });
      applied++;
    } else {
      // 3 = only the message log matched, 2 = nothing matched (kept for inspection).
      await db.log_js_webhook_que.update({ where: { id: q.id }, data: { moved: logs.count > 0 ? 3 : 2 } });
      unmatched++;
    }
  }
  if (unmatched) log(`${unmatched} status(es) matched no message`);
  return applied;
}

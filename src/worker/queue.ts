// Runs one pass of a queue lane: claim queued messages, then send them.
// Replaces cron/wa_cron.php, wa_novelty.php, wa_clients.php and send_whatsapp.php.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { MsgStatus, sendClaimedMessages } from "@/lib/wa/sender";
import type { Lane } from "./lanes";

type Log = (line: string) => void;

/** Users eligible for a lane (active WhatsApp sub-users with a valid plan). */
async function laneUsers(lane: Lane, parentIds?: number[]): Promise<number[]> {
  const f = lane.kind === "users" ? lane.users : { parentIn: parentIds };
  const users = await db.js_user.findMany({
    where: {
      u_wa_plan_status: 1,
      u_status: 1,
      u_type: 2,
      u_dstatus: 0,
      u_parent_id: { ...(f.parentIn ? { in: f.parentIn } : {}), ...(f.parentNotIn ? { notIn: f.parentNotIn } : {}) },
      u_id: { ...(f.idIn ? { in: f.idIn } : {}), ...(f.idNotIn ? { notIn: f.idNotIn } : {}) },
    },
    orderBy: { u_id: "asc" },
    select: { u_id: true },
  });
  return users.map((u) => u.u_id);
}

/**
 * Atomically moves up to `limit` queued messages of a user to Processing (6).
 * FOR UPDATE SKIP LOCKED means two workers can never claim the same message,
 * which the PHP crons did not guarantee.
 */
export async function claim(userId: number, limit: number, since: number): Promise<bigint[]> {
  if (limit <= 0) return [];
  const rows = await db.$queryRaw<{ m_id: bigint }[]>(Prisma.sql`
    UPDATE js_message SET m_status = ${MsgStatus.Processing}, m_in_process_on = ${now()}
     WHERE m_id IN (
       SELECT m_id FROM js_message
        WHERE m_user_id = ${userId} AND m_status = ${MsgStatus.InQueue} AND m_is_incoming = 2
          AND m_dstatus = 0 AND m_created_on >= ${since}
        ORDER BY m_id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING m_id`);
  return rows.map((r) => r.m_id).sort((a, b) => (a < b ? -1 : 1));
}

async function sendAll(ids: bigint[], userId: number, lane: Lane, log: Log): Promise<number> {
  let sent = 0;
  for (const msgId of ids) {
    sent += await sendClaimedMessages({ msgId, userId, variant: lane.variant, log });
  }
  return sent;
}

const pendingCount = (userId: number, since: number) =>
  db.js_message.count({
    where: { m_user_id: userId, m_status: MsgStatus.InQueue, m_is_incoming: 2, m_dstatus: 0, m_created_on: { gte: since } },
  });

const phpDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(d).replace(/ (\w{3}) /, "-$1-").replace(",", ""); // e.g. 02-Nov-2026 23:15:00

/** One pass of a lane. Returns messages sent. */
export async function runLane(lane: Lane, log: Log): Promise<number> {
  const since = istParts().startOfDay - lane.queueWindowSeconds;

  if (lane.kind === "users") {
    let sent = 0;
    for (const userId of await laneUsers(lane)) {
      sent += await sendAll(await claim(userId, lane.perUserLimit, since), userId, lane, log);
    }
    return sent;
  }

  // group lane (send_whatsapp.php)
  const row = await db.js_master_value.findUnique({ where: { mv_id: lane.masterValueId } });
  const parentIds = (row?.mv_desc ?? "").split(",").map(Number).filter((n) => n > 0);
  if (!row || parentIds.length === 0) return 0;

  await db.js_master_value.update({
    where: { mv_id: lane.masterValueId },
    data: { mv_value1: phpDate(), mv_value2: "", mv_value4: "", mv_value3: "running" },
  });

  let sent = 0;
  try {
    const users: number[] = [];
    for (const u of await laneUsers(lane, parentIds)) if ((await pendingCount(u, since)) > 0) users.push(u);
    const perUser = users.length ? Math.round(lane.totalLimit / users.length) : 0;
    for (const userId of users) {
      sent += await sendAll(await claim(userId, perUser, since), userId, lane, log);
    }
  } finally {
    await db.js_master_value.update({
      where: { mv_id: lane.masterValueId },
      data: { mv_value2: phpDate(), mv_value3: "completed", mv_value4: String(sent) },
    });
  }
  return sent;
}

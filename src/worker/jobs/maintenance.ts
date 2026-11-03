// Housekeeping jobs. Ports of cron/user_status.php, cron/delete_msg.php and
// cron/delete_folders.php (all three ran from delete_folders.sh).
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { istParts, now } from "@/lib/config";
import { MsgStatus } from "@/lib/wa/sender";
import { mediaRoot } from "@/lib/wa/media";

/** user_status.php: plans expire one day after u_valid_till. */
export async function expirePlans(): Promise<number> {
  const res = await db.js_user.updateMany({
    where: { u_status: 1, u_wa_plan_status: 1, u_type: 2, u_dstatus: 0, u_valid_till: { lt: now() - 86_398 } },
    data: { u_wa_plan_status: 2 },
  });
  return res.count;
}

/** delete_msg.php: messages still queued after 10 days are "System Cancelled" (5). */
export async function cancelStaleQueued(): Promise<number> {
  const res = await db.js_message.updateMany({
    where: { m_is_incoming: 2, m_status: { lt: 3 }, m_dstatus: 0, m_created_on: { lte: now() - 10 * 86_400 } },
    data: { m_status: MsgStatus.SystemCancelled, m_updated_on: now() },
  });
  return res.count;
}

/**
 * delete_folders.php: removes the dated (yymmdd) temp folders under media/attachment and
 * media/wa_msg, keeping today's. PHP only removed exactly yesterday's folder, so a missed
 * run left folders behind for good; this removes every older one.
 */
export async function deleteOldMediaFolders(log: (l: string) => void): Promise<number> {
  // Only with an explicit MEDIA_ROOT: locally public/media links to the PHP app's media folder.
  if (!process.env.MEDIA_ROOT) {
    log("MEDIA_ROOT not set, media folder cleanup skipped");
    return 0;
  }
  const { yymmdd: today } = istParts();
  let removed = 0;
  for (const sub of ["attachment", "wa_msg"]) {
    const dir = path.join(mediaRoot(), sub);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory() && /^\d{6}$/.test(e.name) && e.name < today) {
        await rm(path.join(dir, e.name), { recursive: true, force: true });
        removed++;
      }
    }
  }
  if (removed) log(`removed ${removed} old media folder(s)`);
  return removed;
}

export async function dailyCleanup(log: (l: string) => void): Promise<number> {
  const folders = await deleteOldMediaFolders(log);
  const plans = await expirePlans();
  const cancelled = await cancelStaleQueued();
  if (plans) log(`${plans} plan(s) expired`);
  if (cancelled) log(`${cancelled} stale queued message(s) cancelled`);
  return folders + plans + cancelled;
}

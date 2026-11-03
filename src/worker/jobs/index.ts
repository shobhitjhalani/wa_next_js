// Scheduled (non-sending) jobs run by the worker next to the send lanes.
// The PHP crontab itself was not in the repo; schedules below follow each script's intent.
import { applyWebhookQueue } from "./webhook-que";
import { dailyCleanup, expirePlans } from "./maintenance";
import { sendTemplateReports, sendWaReport } from "./reports";

type Log = (line: string) => void;

export type Job = {
  name: string;
  /** Run every N seconds, or once a day at HH:MM India time. */
  schedule: { everySeconds: number } | { dailyAt: string };
  run: (log: Log) => Promise<number>;
};

const reportTime = process.env.REPORT_EMAIL_TIME ?? "21:00";

export const JOBS: Job[] = [
  // cron/webhook_que.php: delivery statuses should show up quickly.
  { name: "webhook-que", schedule: { everySeconds: Number(process.env.WEBHOOK_QUE_INTERVAL_SECONDS ?? 30) }, run: applyWebhookQueue },
  // cron/user_status.php: cheap, so hourly instead of only with the nightly cleanup.
  { name: "plan-expiry", schedule: { everySeconds: 3600 }, run: () => expirePlans() },
  // cron/delete_folders.sh: delete_folders.php + delete_msg.php + user_status.php.
  { name: "daily-cleanup", schedule: { dailyAt: process.env.CLEANUP_TIME ?? "00:30" }, run: dailyCleanup },
  // cron/email.php and cron/user_email.php.
  { name: "wa-report-email", schedule: { dailyAt: reportTime }, run: async (log) => (await sendWaReport(log), 1) },
  { name: "template-report-email", schedule: { dailyAt: reportTime }, run: sendTemplateReports },
];

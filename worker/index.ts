/**
 * Long-running background worker (alternative to the cron entry):
 *
 *   npm run worker
 *
 * Checks the schedule in worker/schedule.ts every 10 seconds. Use either this
 * worker or the cron line (`npm run wa -- schedule` every minute) — running
 * both is harmless (advisory locks + wa_job_runs), just redundant.
 */
import { config } from '@/lib/config';
import { pool } from '@/lib/db';
import { JOBS, isDue, runJob, runningJobs } from './schedule';

let stopping = false;

function tick() {
  if (stopping) return;
  const now = new Date();
  for (const job of JOBS) {
    void isDue(job, now).then((due) => (due ? runJob(job) : undefined)).catch((e) => console.error(job.name, e));
  }
}

console.log(`wa worker started (TZ=${config.timezone}, send window ${config.sendStartHour}:00–${config.sendEndHour}:00)`);
tick();
const timer = setInterval(tick, 10_000);

async function shutdown(signal: string) {
  console.log(`${signal} received, finishing running jobs…`);
  stopping = true;
  clearInterval(timer);
  const deadline = Date.now() + 120_000;
  while (runningJobs() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

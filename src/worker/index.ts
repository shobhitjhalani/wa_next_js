// Queue worker: a separate long-running process (PM2 app "wa-worker") that sends
// queued WhatsApp messages and runs the scheduled jobs (webhook status queue,
// cleanup, report e-mails). Every lane and job loops on its own, so a slow client
// cannot hold up the others, and a Postgres advisory lock stops two workers
// running the same lane/job at once.
//
//   npm run worker                       # all lanes and jobs
//   npm run worker -- tpem webhook-que   # only these lanes/jobs
//   npm run worker -- --once             # one pass of each, then exit (for testing)
import pg from "pg";
import { db } from "@/lib/db";
import { istParts } from "@/lib/config";
import { LANES, SEND_HOURS, type Lane } from "./lanes";
import { runLane } from "./queue";
import { JOBS, type Job } from "./jobs";
import { pgConfigFromUrl } from "./pg";

const args = process.argv.slice(2);
const once = args.includes("--once");
const only = args.filter((a) => !a.startsWith("--"));
const intervalMs = Number(process.env.WORKER_INTERVAL_SECONDS ?? 60) * 1000;
const lanes = only.length ? LANES.filter((l) => only.includes(l.name)) : LANES;
const jobs = only.length ? JOBS.filter((j) => only.includes(j.name)) : JOBS;

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (name: string, line: string) => console.log(`${new Date().toISOString()} [${name}] ${line}`);

/** Stable 32-bit key per lane/job name for pg_try_advisory_lock. */
const lockKey = (name: string) => [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

// Advisory locks belong to a connection, so all locks live on one dedicated
// connection instead of tying up a Prisma pool connection per lane.
const lockClient = new pg.Client(pgConfigFromUrl());

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const key = lockKey(name);
  const { rows } = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [key]);
  if (!rows[0].locked) return null;
  try {
    return await fn();
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [key]);
  }
}

async function laneLoop(lane: Lane) {
  while (!stopping) {
    const { hour } = istParts();
    if (process.env.WORKER_IGNORE_HOURS === "1" || (hour >= SEND_HOURS.from && hour < SEND_HOURS.to)) {
      try {
        const sent = await withLock(lane.name, () => runLane(lane, (l) => log(lane.name, l)));
        if (sent === null) log(lane.name, "skipped: already running elsewhere");
        else if (sent > 0) log(lane.name, `processed ${sent}`);
      } catch (e) {
        log(lane.name, `error: ${(e as Error).stack ?? e}`);
      }
    } else if (once) {
      log(lane.name, `outside send hours (${SEND_HOURS.from}:00-${SEND_HOURS.to}:00 IST)`);
    }
    if (once) return;
    await sleep(intervalMs);
  }
}

/** Current India time as "HH:MM". */
function istHHMM() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return `${p.hour}:${p.minute}`;
}

async function runJob(job: Job) {
  try {
    const n = await withLock(`job:${job.name}`, () => job.run((l) => log(job.name, l)));
    if (n === null) log(job.name, "skipped: already running elsewhere");
    else if (n > 0 || once) log(job.name, `done (${n})`);
  } catch (e) {
    log(job.name, `error: ${(e as Error).stack ?? e}`);
  }
}

async function jobLoop(job: Job) {
  if (once) return runJob(job);
  if ("everySeconds" in job.schedule) {
    while (!stopping) {
      await runJob(job);
      await sleep(job.schedule.everySeconds * 1000);
    }
    return;
  }
  // Daily job: runs when India time reaches dailyAt. Starting after that time today
  // means today's run already happened (or is skipped), so wait for tomorrow.
  const at = job.schedule.dailyAt;
  let lastDay = istHHMM() >= at ? istParts().yymmdd : "";
  while (!stopping) {
    const today = istParts().yymmdd;
    if (today !== lastDay && istHHMM() >= at) {
      lastDay = today;
      await runJob(job);
    }
    await sleep(30_000);
  }
}

async function main() {
  if (!lanes.length && !jobs.length) throw new Error(`No lanes or jobs match: ${only.join(", ")}`);
  await lockClient.connect();
  console.log(
    `wa-worker starting: lanes [${lanes.map((l) => l.name).join(", ")}] every ${intervalMs / 1000}s; ` +
      `jobs [${jobs.map((j) => j.name).join(", ")}]`,
  );
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`${sig}: finishing current passes, then exiting`);
      stopping = true;
    });
  }
  await Promise.all([...lanes.map(laneLoop), ...jobs.map(jobLoop)]);
  await lockClient.end();
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// PM2 process file for the DigitalOcean droplet.
//   pm2 start ecosystem.config.cjs      (first time)
//   pm2 reload ecosystem.config.cjs     (zero-downtime restart; deploy/deploy.sh does this)
//
// Layout on the server (see deploy/deploy.sh):
//   /var/www/wa/current  -> releases/<timestamp>   (this file lives in the release)
//   /var/www/wa/shared/.env, shared/media, shared/storage, shared/logs
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const APP_ROOT = process.env.WA_ROOT || "/var/www/wa";
const SHARED = path.join(APP_ROOT, "shared");
const CURRENT = path.join(APP_ROOT, "current");

// Load shared/.env (Node 22 built-in parser, no dotenv needed).
const envFile = path.join(SHARED, ".env");
const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
const env = { NODE_ENV: "production", TZ: "Asia/Kolkata", ...fileEnv };

const logs = (name) => ({
  out_file: path.join(SHARED, "logs", `${name}.out.log`),
  error_file: path.join(SHARED, "logs", `${name}.err.log`),
  merge_logs: true,
  time: true,
});

// WORKER_ENABLED=0 in shared/.env leaves the queue worker out (test phase, before cut-over).
const workerEnabled = env.WORKER_ENABLED !== "0";

module.exports = {
  apps: [
    {
      name: "wa-web",
      cwd: path.join(CURRENT, ".next/standalone"),
      script: "server.js",
      // Two instances in cluster mode let `pm2 reload` restart one at a time (no downtime).
      exec_mode: "cluster",
      instances: Number(process.env.WA_WEB_INSTANCES || 2),
      env: { ...env, PORT: "3000", HOSTNAME: "127.0.0.1" },
      max_memory_restart: "700M",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "20s",
      restart_delay: 3000,
      kill_timeout: 10000,
      listen_timeout: 15000,
      ...logs("wa-web"),
    },
    workerEnabled && {
      name: "wa-worker",
      cwd: CURRENT,
      script: "node_modules/.bin/tsx",
      args: "src/worker/index.ts",
      interpreter: "none",
      // Exactly one worker process: lanes also hold Postgres advisory locks, so a
      // second copy would only skip, but there is no reason to run one.
      exec_mode: "fork",
      instances: 1,
      env,
      max_memory_restart: "600M",
      autorestart: true,
      max_restarts: 50,
      min_uptime: "30s",
      restart_delay: 10000,
      // On SIGTERM the worker finishes the pass it is in (a batch can take minutes
      // of API calls), so give it up to 5 minutes before PM2 force-kills it.
      kill_timeout: 300000,
      ...logs("wa-worker"),
    },
  ].filter(Boolean),
};

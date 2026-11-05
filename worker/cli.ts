/**
 * Run a job once (the Laravel artisan commands):
 *
 *   npm run wa -- send-queue [--user=74] [--force]
 *   npm run wa -- dispatch-campaigns
 *   npm run wa -- process-webhooks
 *   npm run wa -- expire-plans
 *   npm run wa -- expire-messages   cancel queued messages older than WA_MSG_EXPIRY (24h)
 *   npm run wa -- cleanup
 *   npm run wa -- email-reports [--user=46,47] [--admin-only]
 *   npm run wa -- inbox-rebuild [--user=74]
 *   npm run wa -- schedule        run every job that is due (cron entry, = php artisan schedule:run)
 */
import { pool } from '@/lib/db';
import { cleanup, dispatchCampaigns, emailReports, expireMessages, expirePlans, inboxRebuild, processWebhooks, sendQueue } from './jobs';
import { runDueJobs } from './schedule';

const [command, ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || 'true'];
}));
const user = opts.user ? parseInt(opts.user, 10) : undefined;

const commands: Record<string, () => Promise<unknown>> = {
  'send-queue': () => sendQueue({ user, force: opts.force === 'true' }),
  'dispatch-campaigns': () => dispatchCampaigns(),
  'process-webhooks': () => processWebhooks(),
  'expire-plans': () => expirePlans(),
  'expire-messages': () => expireMessages(),
  cleanup: () => cleanup(),
  'email-reports': () => emailReports({ users: opts.user ? String(opts.user).split(',').map(Number) : undefined, adminOnly: opts['admin-only'] === 'true' }),
  'inbox-rebuild': () => inboxRebuild({ user }),
  schedule: () => runDueJobs(),
};

if (!command || !commands[command]) {
  console.log(`Usage: npm run wa -- <command> [options]\nCommands: ${Object.keys(commands).join(', ')}`);
  process.exit(command ? 1 : 0);
}

try {
  await commands[command]();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await pool.end();
}

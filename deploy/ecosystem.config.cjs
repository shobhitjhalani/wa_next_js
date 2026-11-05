// pm2 processes on the server. cwd is the `current` symlink, so a restart picks up the newest release.
const CWD = '/var/www/wa/current';
module.exports = {
  apps: [
    // 2 instances in cluster mode: `pm2 reload` replaces them one at a time, so there is no gap during a deploy
    { name: 'wa-app', cwd: CWD, script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000', exec_mode: 'cluster', instances: 2,
      env: { NODE_ENV: 'production' }, max_memory_restart: '700M' },
    { name: 'wa-worker', cwd: CWD, script: 'npm', args: 'run worker',
      env: { NODE_ENV: 'production' }, max_memory_restart: '500M', kill_timeout: 30000 },
  ],
};

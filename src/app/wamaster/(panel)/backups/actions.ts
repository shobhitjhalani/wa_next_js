'use server';

import { revalidatePath } from 'next/cache';
import { flash } from '@/lib/actions';
import { requireAdminCan } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { backupMissing } from '@/lib/services/backup';

/** "Back up now": queue a backup for the worker (a dump takes minutes, longer than a request may). */
export async function backupNow(): Promise<void> {
  const me = await requireAdminCan('super');
  if (backupMissing().length) {
    await flash('error', 'Backups are not configured yet (DigitalOcean Spaces settings missing in .env).');
  } else if (await one(`SELECT 1 FROM wa_backup_runs WHERE status IN ('queued', 'running') LIMIT 1`)) {
    await flash('error', 'A backup is already queued or running.');
  } else {
    await query(`INSERT INTO wa_backup_runs (trigger, requested_by) VALUES ('manual', $1)`, [me.emp_id]);
    await flash('success', 'Backup queued. It starts within a minute and takes a few minutes; refresh to see it.');
  }
  revalidatePath('/wamaster/backups');
}

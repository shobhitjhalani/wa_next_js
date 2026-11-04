'use server';

import { redirect } from 'next/navigation';
import { fAll, flash, fStr } from '@/lib/actions';
import { requireAdmin } from '@/lib/auth';
import { exec } from '@/lib/db';
import { now } from '@/lib/time';

/** Delete or re-queue selected outgoing messages (ReportController::bulk, POST /wamaster/reports/messages/bulk). */
export async function bulkMessages(fd: FormData): Promise<void> {
  await requireAdmin();
  const backRaw = fStr(fd, 'back');
  const back = /^\/wamaster\/reports\/messages\/[a-z_]+(\?[^\\]*)?$/.test(backRaw) && !backRaw.startsWith('//') ? backRaw : '/wamaster/reports/messages/que';

  const raw = fAll(fd, 'mids[]').map((v) => v.trim());
  const cstatus = fStr(fd, 'cstatus');
  const errors: string[] = [];
  if (!raw.length) errors.push('The mids field is required.');
  raw.forEach((v, i) => { if (!/^[+-]?\d+$/.test(v)) errors.push(`The mids.${i} field must be an integer.`); });
  if (cstatus === '') errors.push('The cstatus field is required.');
  else if (!['1', '2'].includes(cstatus)) errors.push('The selected cstatus is invalid.');
  if (errors.length) {
    await flash('error', errors.join('\n'));
    redirect(back);
  }

  const ids = [...new Set(raw.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  const n = cstatus === '1'
    ? await exec('UPDATE js_message SET m_dstatus = 1, m_updated_on = $2 WHERE m_id = ANY($1::bigint[]) AND m_is_incoming = 2', [ids, now()])
    : await exec(
      `UPDATE js_message SET m_status = 1, m_delivery_status = NULL, m_error_codes = NULL, m_status_response = NULL, m_message_id = NULL, m_updated_on = $2
        WHERE m_id = ANY($1::bigint[]) AND m_is_incoming = 2`, [ids, now()]);

  await flash('success', `${n} messages ${cstatus === '1' ? 'deleted' : 're-queued'}`);
  redirect(back);
}

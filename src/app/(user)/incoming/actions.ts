'use server';

import { refresh } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { flash, fInts, fStr } from '@/lib/actions';
import { query } from '@/lib/db';
import { refreshUnread } from '@/lib/models';

/** Mark the ticked incoming messages read / unread (IncomingController::markRead, POST /incoming/read). */
export async function markIncoming(fd: FormData): Promise<void> {
  const user = await requireUser();
  const mids = fInts(fd, 'mids');
  const cstatus = fStr(fd, 'cstatus');
  if (!mids.length) {
    await flash('error', 'The mids field is required.');
  } else if (cstatus === '') {
    await flash('error', 'The cstatus field is required.');
  } else if (cstatus !== '1' && cstatus !== '2') {
    await flash('error', 'The selected cstatus is invalid.');
  } else {
    const rows = await query<{ m_mobile_no: string | null }>(
      'UPDATE js_message SET m_is_read = $3 WHERE m_user_id = $1 AND m_id = ANY($2::bigint[]) RETURNING m_mobile_no',
      [user.u_id, mids, Number(cstatus)],
    );
    await refreshUnread(user.u_id, rows.map((r) => r.m_mobile_no ?? ''));
    await flash('success', 'Status updated');
  }
  refresh();
}

'use server';

import { refresh } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { flash, fInts, fStr } from '@/lib/actions';
import { exec } from '@/lib/db';

/** Mark the ticked flow responses read / unread. */
export async function markFlowResponses(fd: FormData): Promise<void> {
  const user = await requireUser();
  const ids = fInts(fd, 'ids');
  const status = fStr(fd, 'cstatus');
  if (!ids.length) await flash('error', 'Select at least one response.');
  else if (status !== '1' && status !== '2') await flash('error', 'Choose Read or Un-Read.');
  else {
    await exec('UPDATE js_flow_responses SET fr_is_read = $3 WHERE fr_user_id = $1 AND fr_id = ANY($2::bigint[])', [user.u_id, ids, Number(status)]);
    await flash('success', 'Status updated');
  }
  refresh();
}

/** One response opened from the list: mark it read. */
export async function readFlowResponse(id: number): Promise<void> {
  const user = await requireUser();
  await exec('UPDATE js_flow_responses SET fr_is_read = 1 WHERE fr_user_id = $1 AND fr_id = $2', [user.u_id, id]);
  refresh();
}

export async function markAllFlowResponsesRead(): Promise<void> {
  const user = await requireUser();
  const n = await exec('UPDATE js_flow_responses SET fr_is_read = 1 WHERE fr_user_id = $1 AND fr_is_read = 2', [user.u_id]);
  await flash('success', n ? `${n} response(s) marked as read` : 'Nothing unread');
  refresh();
}

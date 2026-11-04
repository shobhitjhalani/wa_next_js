'use server';

import { notFound } from 'next/navigation';
import { refresh } from 'next/cache';
import { flash } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec, one } from '@/lib/db';
import { messageStatusLabel } from '@/lib/format';
import { inSendWindow, sendNow, sendWindowLabel } from '@/lib/services/sender';
import type { MessageRow } from '@/lib/types';

type StatusFields = Pick<MessageRow, 'm_status' | 'm_message_id' | 'm_delivery_status' | 'm_status_response'>;

/** Re-queue a single message and send it now (legacy send_wa.php, POST /send_wa/{id}); campaign messages only inside the sending window. */
export async function resendMessage(id: number): Promise<void> {
  const user = await requireUser();
  const msg = await one<{ m_campaign_id: number | null }>(
    'SELECT m_campaign_id FROM js_message WHERE m_id = $1 AND m_user_id = $2 AND m_is_incoming = 2', [id, user.u_id]);
  if (!msg) notFound();
  if (Number(msg.m_campaign_id) > 0 && !inSendWindow()) {
    await flash('error', `Campaign messages can only be sent between ${sendWindowLabel()}. It stays in the queue and goes out automatically when the window opens.`);
    refresh();
    return;
  }
  const found = await exec(
    `UPDATE js_message SET m_delivery_status = NULL, m_error_codes = NULL, m_status_response = NULL
      WHERE m_id = $1 AND m_user_id = $2 AND m_is_incoming = 2`,
    [id, user.u_id],
  );
  if (!found) notFound();
  await sendNow(id);
  const fresh = await one<StatusFields>(
    'SELECT m_status, m_message_id, m_delivery_status, m_status_response FROM js_message WHERE m_id = $1', [id]);
  await flash('success', 'Message sent: ' + (fresh ? messageStatusLabel(fresh) : ''));
  refresh();
}

/** "Cancel All" on the queue page removes every pending message (POST /que/cancel). */
export async function cancelQueue(): Promise<void> {
  const user = await requireUser();
  const n = await exec(
    `UPDATE js_message SET m_dstatus = 1
      WHERE m_user_id = $1 AND m_is_incoming = 2 AND m_status IN (1, 6) AND m_dstatus = 0`,
    [user.u_id],
  );
  await flash('success', `${n} Messages Cancelled`);
  refresh();
}

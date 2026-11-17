'use server';

import { revalidatePath } from 'next/cache';
import { flash } from '@/lib/actions';
import { requireAdminCan } from '@/lib/auth';
import { resetSendSettings, saveSendSettings, validSendSettings } from '@/lib/services/settings';

/** Save the sending limits (super admin). */
export async function saveSendLimits(form: FormData): Promise<void> {
  const me = await requireAdminCan('super');
  const s = {
    sendBatch: Number(form.get('send_batch')),
    sendStartHour: Number(form.get('send_start_hour')),
    sendEndHour: Number(form.get('send_end_hour')),
  };
  const error = validSendSettings(s);
  if (error) await flash('error', error);
  else {
    await saveSendSettings(s, me.emp_id);
    await flash('success', 'Sending limits saved. The sender uses them from its next run (within a minute).');
  }
  revalidatePath('/wamaster/settings');
}

export async function resetSendLimits(): Promise<void> {
  await requireAdminCan('super');
  await resetSendSettings();
  await flash('success', 'Sending limits reset to the server defaults.');
  revalidatePath('/wamaster/settings');
}

'use server';

import { refresh } from 'next/cache';
import { flash } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { cancelCampaign } from '@/lib/services/campaigns';
import { numberFormat } from '@/lib/text';
import { CAMPAIGN } from '@/lib/types';

/** POST campaigns/{id}/cancel (CampaignController::cancel). */
export async function cancelCampaignAction(id: number): Promise<void> {
  const user = await requireUser();
  const campaign = await one<{ uc_id: number; uc_status: number }>('SELECT uc_id, uc_status FROM js_user_campaign WHERE uc_id = $1 AND uc_user_id = $2', [id, user.u_id]);
  if (!campaign) {
    await flash('error', 'Campaign not found.');
    refresh();
    return;
  }
  const wasScheduled = Number(campaign.uc_status) === CAMPAIGN.SCHEDULED;
  const cancelled = await cancelCampaign(campaign.uc_id);
  await flash('success', wasScheduled
    ? 'Scheduled campaign cancelled.'
    : `${numberFormat(cancelled)} queued message(s) cancelled. Messages already sent are not affected.`);
  refresh();
}

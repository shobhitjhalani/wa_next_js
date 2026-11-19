'use server';

import { refresh } from 'next/cache';
import { flash } from '@/lib/actions';
import { requireTeam } from '@/lib/auth';
import { one } from '@/lib/db';
import { cancelCampaign, resendFailed } from '@/lib/services/campaigns';
import { inSendWindow, sendWindowLabel } from '@/lib/services/sender';
import { templateQuota } from '@/lib/services/template-limit';
import { numberFormat } from '@/lib/text';
import { CAMPAIGN } from '@/lib/types';
import { refreshSendSettings } from '@/lib/services/settings';

/** POST campaigns/{id}/cancel (CampaignController::cancel). */
export async function cancelCampaignAction(id: number): Promise<void> {
  // Cancel / resend: the owner, or a member who may create campaigns and see this one
  const { user, member, perms } = await requireTeam((p) => p.campaignCreate && p.campaignView !== 'none');
  const campaign = await one<{ uc_id: number; uc_status: number }>('SELECT uc_id, uc_status FROM js_user_campaign WHERE uc_id = $1 AND uc_user_id = $2 AND ($3::int = 0 OR uc_member_id = $3)', [id, user.u_id, member && perms.campaignView === 'own' ? member.um_id : 0]);
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

/** "Resend Failed": queue every failed message of the campaign again. */
export async function resendFailedAction(id: number): Promise<void> {
  // Cancel / resend: the owner, or a member who may create campaigns and see this one
  const { user, member, perms } = await requireTeam((p) => p.campaignCreate && p.campaignView !== 'none');
  await refreshSendSettings();
  const campaign = await one<{ uc_id: number; uc_status: number }>('SELECT uc_id, uc_status FROM js_user_campaign WHERE uc_id = $1 AND uc_user_id = $2 AND ($3::int = 0 OR uc_member_id = $3)', [id, user.u_id, member && perms.campaignView === 'own' ? member.um_id : 0]);
  if (!campaign) {
    await flash('error', 'Campaign not found.');
  } else if (Number(campaign.uc_status) === CAMPAIGN.CANCELLED || Number(campaign.uc_status) === CAMPAIGN.SCHEDULED) {
    await flash('error', 'Only failed messages of a sent campaign can be resent.');
  } else if ((await templateQuota(user.u_id)).remaining === 0) {
    await flash('error', 'Your template message limit has been reached. Please contact support to increase it.');
  } else {
    const queued = await resendFailed(campaign.uc_id, user.u_id);
    await flash(queued ? 'success' : 'error', !queued
      ? 'There are no messages with delivery status "failed" to resend.'
      : `${numberFormat(queued)} failed message(s) queued again.` + (inSendWindow() ? '' : ` They go out when the sending window opens (${sendWindowLabel()}).`));
  }
  refresh();
}

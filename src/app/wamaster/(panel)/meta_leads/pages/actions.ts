'use server';

import { revalidatePath } from 'next/cache';
import { flash } from '@/lib/actions';
import { logActivity } from '@/lib/activity';
import { requireSuperAdmin } from '@/lib/admin-access';
import { one, value } from '@/lib/db';
import { connectPage, disconnectPage } from '@/lib/services/lead-pages';
import { USER_TYPE } from '@/lib/types';

const PATH = '/wamaster/meta_leads/pages';
const PAGE_ID = /^\d{5,25}$/;

/** Connect a Page / change its client (super admin). */
export async function saveLeadPage(form: FormData): Promise<void> {
  const { admin } = await requireSuperAdmin();
  const pageId = String(form.get('page_id') ?? '').trim();
  const name = String(form.get('page_name') ?? '').trim();
  const userId = Number(form.get('user_id') ?? 0) || 0;
  if (!PAGE_ID.test(pageId)) {
    await flash('error', 'Invalid Page.');
    revalidatePath(PATH);
    return;
  }
  let client = '';
  if (userId) {
    const u = await one<{ name: string; crm: number }>(
      `SELECT COALESCE(NULLIF(u_company_name, ''), NULLIF(u_name, ''), u_username::text) AS name, u_crm AS crm
         FROM js_user WHERE u_id = $1 AND u_dstatus = 0 AND u_type = $2`, [userId, USER_TYPE.WHATSAPP]);
    if (!u) {
      await flash('error', 'Choose a WhatsApp client.');
      revalidatePath(PATH);
      return;
    }
    client = u.name;
  }
  const before = await value<number>('SELECT lp_user_id FROM js_meta_lead_page WHERE lp_page_id = $1', [pageId]);
  const { error, requeued } = await connectPage(pageId, name, userId, admin.emp_id);
  await logActivity({
    module: 'meta_leads', action: before === null ? 'Connected lead Page' : 'Changed lead Page client', target: `${name || pageId} (${pageId})`, targetId: pageId,
    details: [`Client: ${client || 'Not assigned'}`, ...(requeued ? [`${requeued} waiting lead(s) filed`] : []), ...(error ? [`Subscribe failed: ${error.slice(0, 200)}`] : [])],
  });
  if (error) await flash('error', `Saved, but Meta refused the lead subscription: ${error}`);
  else await flash('success', `${name || pageId}: leads now go to ${client || 'nobody yet (they wait until you choose a client)'}.${requeued ? ` ${requeued} waiting lead(s) are being filed.` : ''}`);
  revalidatePath(PATH);
}

/** Stop filing a Page's leads. */
export async function removeLeadPage(form: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = String(form.get('page_id') ?? '').trim();
  const name = await value<string>('SELECT lp_name FROM js_meta_lead_page WHERE lp_page_id = $1', [pageId]);
  if (await disconnectPage(pageId)) {
    await logActivity({ module: 'meta_leads', action: 'Disconnected lead Page', target: `${name || pageId} (${pageId})`, targetId: pageId });
    await flash('success', `${name || pageId} disconnected. Its new leads wait until it is connected again.`);
  }
  revalidatePath(PATH);
}

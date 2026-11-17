import 'server-only';
import { one } from '@/lib/db';
import { findTemplate } from '@/lib/services/meta';

/** Statuses WhatsApp lets you edit (pending / in-appeal templates can't be changed). */
const EDITABLE_STATUSES = ['APPROVED', 'REJECTED', 'PAUSED'];

/**
 * The account's template `id` and the same template on WhatsApp, with the reason it can't be
 * edited (if any). Only standard templates (incl. Flow buttons) are editable here.
 */
export async function loadEditableTemplate(userId: number, user: { u_wa_b_id: string | null; u_wa_phone_id: string | null }, id: number) {
  const row = await one<{ ut_id: number; ut_name: string; ut_language: string | null; ut_template_type: string }>(
    'SELECT ut_id, ut_name, ut_language, ut_template_type FROM js_user_templates WHERE ut_id = $1 AND ut_user_id = $2 AND ut_dstatus = 0',
    [id, userId]);
  if (!row) return null;
  const meta = user.u_wa_b_id ? await findTemplate(user, row.ut_name, row.ut_language) : null;
  let problem = '';
  if (!meta) problem = 'This template could not be found on WhatsApp. Use “Sync from WhatsApp” and try again.';
  else if (meta.category === 'AUTHENTICATION' || row.ut_template_type === 'Authentication') problem = 'Authentication templates can only be changed in WhatsApp Manager.';
  else if ((meta.components ?? []).some((c: any) => String(c.type).toUpperCase() === 'CAROUSEL')) problem = 'Carousel templates can only be changed in WhatsApp Manager.';
  else if (!EDITABLE_STATUSES.includes(String(meta.status))) problem = `WhatsApp is still reviewing this template (status: ${String(meta.status).toLowerCase()}). It can be edited once the review is finished.`;
  return { row, meta, problem };
}

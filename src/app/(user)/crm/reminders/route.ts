import { getUser } from '@/lib/auth';
import { OPEN_STATUSES } from '@/lib/crm';
import { query } from '@/lib/db';
import { now } from '@/lib/time';

/** GET /crm/reminders — follow-ups due now (polled by the reminder pop-up in the panel). */
export async function GET() {
  const user = await getUser();
  if (!user || Number(user.u_crm) !== 1) return Response.json({ due: [] }, { status: user ? 403 : 401 });
  const rows = await query<{ id: number; name: string; mobile: string; at: number }>(
    `SELECT ld_id AS id, ld_name AS name, ld_mobile AS mobile, ld_next_followup AS at
       FROM js_crm_lead
      WHERE ld_user_id = $1 AND ld_next_followup > 0 AND ld_next_followup <= $2 AND ld_status = ANY($3::smallint[])
      ORDER BY ld_next_followup DESC LIMIT 20`, [user.u_id, now(), OPEN_STATUSES]);
  return Response.json({ due: rows }, { headers: { 'Cache-Control': 'no-store' } });
}

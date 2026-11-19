import { teamAccount } from '@/lib/auth';
import { like, one, query } from '@/lib/db';

export interface GroupContactsPage {
  group: string;
  total: number;
  page: number;
  perPage: number;
  rows: { id: number; name: string; mobile: string; optOut: boolean }[];
}

const PER_PAGE = 50;

/**
 * One page of a contact group's members, for the group popup on the compose screen
 * (GET /groups/{id}/contacts?q=&page=). Only the signed-in user's own groups.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = (await teamAccount((p) => p.campaignCreate))?.user;
  if (!user) return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
  const id = parseInt((await ctx.params).id, 10) || 0;
  const group = await one<{ up_group_name: string | null }>(
    'SELECT up_group_name FROM js_user_groups WHERE ug_id = $1 AND ug_user_id = $2 AND ug_dstatus = 0', [id, user.u_id]);
  if (!group) return Response.json({ message: 'Group not found.' }, { status: 404 });

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const rows = await query<{ cl_id: number; cl_name: string | null; cl_mobile_no: string | null; cl_opt_out: number; total: number }>(
    `SELECT c.cl_id, c.cl_name, c.cl_mobile_no, c.cl_opt_out, COUNT(*) OVER ()::int AS total
       FROM js_user_groups_contact gc
       JOIN js_user_contact_list c ON c.cl_id = gc.contact_id
      WHERE gc.group_id = $1 AND ($2 = '' OR c.cl_mobile_no LIKE '%' || $2 || '%' OR c.cl_name ILIKE '%' || $2 || '%')
      ORDER BY c.cl_name NULLS LAST, c.cl_mobile_no
      LIMIT ${PER_PAGE} OFFSET $3`,
    [id, like(q), (page - 1) * PER_PAGE],
  );
  // Past the last page COUNT(*) OVER () has no row to ride on; count separately then
  const total = rows[0]?.total ?? (page > 1
    ? (await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM js_user_groups_contact gc JOIN js_user_contact_list c ON c.cl_id = gc.contact_id
        WHERE gc.group_id = $1 AND ($2 = '' OR c.cl_mobile_no LIKE '%' || $2 || '%' OR c.cl_name ILIKE '%' || $2 || '%')`, [id, like(q)]))?.n ?? 0
    : 0);

  const body: GroupContactsPage = {
    group: group.up_group_name ?? '',
    total,
    page,
    perPage: PER_PAGE,
    rows: rows.map((r) => ({ id: r.cl_id, name: r.cl_name ?? '', mobile: r.cl_mobile_no ?? '', optOut: Number(r.cl_opt_out) === 1 })),
  };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

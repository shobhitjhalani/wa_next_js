import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { csvResponse } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { filterWhere, readFilter } from '../filter';

/** GET /contacts/export — the filtered contact list as CSV (ContactController::export), streamed. */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/', req.url));

  const params: unknown[] = [];
  const where = filterWhere(user.u_id, readFilter(req.nextUrl.searchParams), params);
  return csvResponse<{ cl_mobile_no: string | null; cl_name: string | null; groups: string | null; cl_opt_out: number; cl_last_msg: string | null }>(
    `contacts-${phpDate('Y-m-d')}.csv`,
    ['Mobile', 'Name', 'Groups', 'Opted Out', 'Last Message'],
    `SELECT c.cl_mobile_no, c.cl_name, c.cl_opt_out, c.cl_last_msg,
            (SELECT string_agg(g.up_group_name::text, '; ' ORDER BY gc.id)
               FROM js_user_groups_contact gc JOIN js_user_groups g ON g.ug_id = gc.group_id
              WHERE gc.contact_id = c.cl_id) AS groups
       FROM js_user_contact_list c WHERE ${where} ORDER BY c.cl_id`,
    params,
    (r) => [r.cl_mobile_no, r.cl_name, r.groups ?? '', Number(r.cl_opt_out) === 1 ? 'Yes' : 'No', r.cl_last_msg],
  );
}

import { NextResponse, type NextRequest } from 'next/server';
import { getAdmin } from '@/lib/auth';
import { assignFilter, getAccess, userModule } from '@/lib/admin-access';
import { csvResponse, sp } from '@/lib/http';
import { phpDate } from '@/lib/time';
import { USER_TYPE } from '@/lib/types';
import { redirectTo } from '@/lib/redirect';

/** CSV of the users of a type the staff member can see (Admin\UserController::export). */
export async function GET(req: NextRequest) {
  if (!(await getAdmin())) return redirectTo('/wamaster');
  const utRaw = sp(req.nextUrl.searchParams, 'ut');
  const type = utRaw === '' ? USER_TYPE.WHATSAPP : parseInt(utRaw, 10) || 0;
  const access = await getAccess();
  if (!access.can(userModule(type))) return new NextResponse('Forbidden', { status: 403 });
  return csvResponse<Record<string, any>>(
    `users_${phpDate('d_m_y')}.csv`,
    ['Code', 'Name', 'Company', 'Username', 'Mobile', 'Email', 'WA No', 'Valid Till', 'Plan Status', 'Status'],
    `SELECT u_code, u_name, u_company_name, u_username, u_mobile_no, u_email_id, u_wa_no, u_valid_till, u_wa_plan_status, u_status
       FROM js_user WHERE u_dstatus = 0 AND u_type = $1 AND ($2::int IS NULL OR u_assign_to = $2::int) ORDER BY u_id`,
    [type, assignFilter(access, type)],
    (u) => [u.u_code, u.u_name, u.u_company_name, u.u_username, u.u_mobile_no, u.u_email_id, u.u_wa_no,
      u.u_valid_till ? phpDate('d-m-Y', Number(u.u_valid_till)) : '', Number(u.u_wa_plan_status) === 1 ? 'Active' : 'Expired',
      Number(u.u_status) === 1 ? 'Active' : 'Inactive'],
  );
}

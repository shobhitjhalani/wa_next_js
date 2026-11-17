import { requireAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { employeeCanAccess, masterOptions } from '@/lib/models';
import { getAccess, MESSAGE_REPORTS, RECHARGE_REPORTS, userModule } from '@/lib/admin-access';
import { Shell } from '@/components/panel/Shell';
import type { MenuItem } from '@/components/panel/Sidebar';

/** Admin panel frame (layouts/admin.blade.php). Every page below requires a signed-in staff member. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin();
  const [canMasters, canTeam, userTypes, access] = await Promise.all([
    employeeCanAccess(me, 'masters'),
    employeeCanAccess(me, 'employee'),
    masterOptions(config.masters.userType),
    getAccess(),
  ]);
  const types = (userTypes.length
    ? userTypes.map((t) => ({ label: t.label, type: Number(t.value) }))
    : [{ label: 'WhatsApp Users', type: 2 }, { label: 'Corporate Users', type: 1 }]
  ).filter((t) => access.can(userModule(t.type)));
  const reports = [
    ...(access.can(MESSAGE_REPORTS) ? [
      { label: 'WA Send', href: '/wamaster/reports/messages/send' },
      { label: 'WA Que', href: '/wamaster/reports/messages/que' },
      { label: 'Campaign Summary', href: '/wamaster/reports/templates' },
    ] : []),
    ...(access.can(RECHARGE_REPORTS) ? [
      { label: 'Recharges', href: '/wamaster/reports/recharges' },
      { label: 'Pending Recharges', href: '/wamaster/reports/recharges_pending' },
    ] : []),
    ...(access.can(MESSAGE_REPORTS) ? [
      { label: 'Summary', href: '/wamaster/reports/summary' },
      { label: 'WA Error', href: '/wamaster/reports/messages/error' },
      { label: 'WA Failed', href: '/wamaster/reports/messages/failed' },
      { label: 'WA In Process', href: '/wamaster/reports/messages/in_process' },
      { label: 'WA Users Activity', href: '/wamaster/reports/wa_users' },
      { label: 'Google Sheets', href: '/wamaster/reports/google_sheets' },
    ] : []),
  ];
  const headings = canMasters
    ? await query<{ mh_id: number; mh_name: string }>('SELECT mh_id, mh_name FROM js_master_heading WHERE mh_status = 2 ORDER BY mh_name')
    : [];

  const menu: MenuItem[] = [
    { label: 'Dashboard', icon: 'ri-home-4-line', href: '/wamaster/dashboard' },
    ...(headings.length
      ? [{ label: 'Data Masters', icon: 'ri-file-list-3-line', match: ['/wamaster/masters'], children: headings.map((h) => ({ label: h.mh_name, href: `/wamaster/masters/${h.mh_id}` })) }]
      : []),
    ...(canTeam ? [{ label: 'Team Members', icon: 'ri-user-2-line', href: '/wamaster/teams' }] : []),
    ...(types.length ? [{
      label: 'Users', icon: 'ri-user-3-line', match: ['/wamaster/users'],
      children: types.map((t) => ({ label: t.label, href: `/wamaster/users?ut=${t.type}`, match: [] })),
    } satisfies MenuItem] : []),
    ...(reports.length ? [{ label: 'Reports', icon: 'ri-file-chart-line', children: reports } satisfies MenuItem] : []),
    ...(me.isSuperAdmin ? [{ label: 'Sending Limits', icon: 'ri-speed-up-line', href: '/wamaster/settings' } satisfies MenuItem] : []),
    ...(me.isSuperAdmin ? [{ label: 'Database Backups', icon: 'ri-database-2-line', href: '/wamaster/backups' } satisfies MenuItem] : []),
  ];

  return (
    <Shell
      home="/wamaster/dashboard"
      profileUrl="/wamaster/profile"
      logoutUrl="/wamaster/logout"
      userName={me.emp_name ?? ''}
      userSub={me.isSuperAdmin ? 'Administrator' : 'Team Member'}
      menu={menu}
    >
      {children}
    </Shell>
  );
}

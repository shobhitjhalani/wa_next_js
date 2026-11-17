import { forbidden, notFound } from 'next/navigation';
import { requireRight } from '@/lib/admin-access';
import { one } from '@/lib/db';
import type { EmployeeRow } from '@/lib/types';
import { TeamForm } from '../../_form';

export default async function EditTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireRight('employee', 'edit');
  const { id } = await params;
  const member = /^\d{1,9}$/.test(id)
    ? await one<EmployeeRow & { emp_right_id: number; emp_address: string | null }>('SELECT * FROM js_employee WHERE emp_id = $1 AND emp_dstatus = 0', [Number(id)])
    : null;
  if (!member) notFound();
  if (Number(member.emp_m_type) === 4 && !admin.isSuperAdmin) forbidden();
  return <TeamForm member={member} />;
}

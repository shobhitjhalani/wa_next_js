import { notFound } from 'next/navigation';
import { requireAdminCan } from '@/lib/auth';
import { one } from '@/lib/db';
import type { EmployeeRow } from '@/lib/types';
import { TeamForm } from '../../_form';

export default async function EditTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminCan('employee');
  const { id } = await params;
  const member = /^\d{1,9}$/.test(id)
    ? await one<EmployeeRow & { emp_right_id: number; emp_address: string | null }>('SELECT * FROM js_employee WHERE emp_id = $1 AND emp_dstatus = 0', [Number(id)])
    : null;
  if (!member) notFound();
  return <TeamForm member={member} />;
}

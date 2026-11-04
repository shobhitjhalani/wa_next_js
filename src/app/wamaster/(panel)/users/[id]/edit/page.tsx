import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { one } from '@/lib/db';
import type { UserRow } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { UserForm } from '../../UserForm';

/** Edit user (Admin\UserController::edit). */
export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const user = await one<UserRow>('SELECT * FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [Number(id)]);
  if (!user) notFound();
  return (
    <>
      <PageTitle title="Edit User" home="/wamaster/dashboard" />
      <UserForm user={user} type={Number(user.u_type)} />
    </>
  );
}

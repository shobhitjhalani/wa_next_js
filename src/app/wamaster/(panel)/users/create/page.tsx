import { requireAdmin } from '@/lib/auth';
import { sp } from '@/lib/http';
import { USER_TYPE } from '@/lib/types';
import { PageTitle } from '@/components/PageTitle';
import { UserForm } from '../UserForm';

/** Add user (Admin\UserController::create). */
export default async function CreateUserPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const utRaw = sp(await searchParams, 'ut');
  const type = utRaw === '' ? USER_TYPE.WHATSAPP : parseInt(utRaw, 10) || 0;
  return (
    <>
      <PageTitle title="Add User" home="/wamaster/dashboard" />
      <UserForm user={null} type={type} />
    </>
  );
}

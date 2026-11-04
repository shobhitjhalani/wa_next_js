import { requireAdminCan } from '@/lib/auth';
import { TeamForm } from '../_form';

export default async function CreateTeamMemberPage() {
  await requireAdminCan('employee');
  return <TeamForm member={null} />;
}

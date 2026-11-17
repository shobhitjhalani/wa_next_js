import { requireRight } from '@/lib/admin-access';
import { TeamForm } from '../_form';

export default async function CreateTeamMemberPage() {
  await requireRight('employee', 'add');
  return <TeamForm member={null} />;
}

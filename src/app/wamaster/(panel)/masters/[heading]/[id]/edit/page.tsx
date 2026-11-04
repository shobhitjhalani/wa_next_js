import { requireAdminCan } from '@/lib/auth';
import { MasterForm } from '../../_form';
import { findHeading, findValue } from '../../_lib';

export default async function EditMasterPage({ params }: { params: Promise<{ heading: string; id: string }> }) {
  await requireAdminCan('masters');
  const { heading, id } = await params;
  const head = await findHeading(heading);
  const value = await findValue(head.mh_id, id);
  return <MasterForm head={head} value={value} />;
}

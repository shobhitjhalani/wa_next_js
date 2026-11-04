import { requireAdminCan } from '@/lib/auth';
import { MasterForm } from '../_form';
import { findHeading } from '../_lib';

export default async function CreateMasterPage({ params }: { params: Promise<{ heading: string }> }) {
  await requireAdminCan('masters');
  const head = await findHeading((await params).heading);
  return <MasterForm head={head} value={null} />;
}

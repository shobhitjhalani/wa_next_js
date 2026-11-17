import { requireRight } from '@/lib/admin-access';
import { MasterForm } from '../_form';
import { findHeading } from '../_lib';

export default async function CreateMasterPage({ params }: { params: Promise<{ heading: string }> }) {
  await requireRight('masters', 'add');
  const head = await findHeading((await params).heading);
  return <MasterForm head={head} value={null} />;
}

import type { Metadata } from 'next';
import { requireAdminCan } from '@/lib/auth';
import { MetaTab, SettingsTabs } from '../parts';

export const metadata: Metadata = { title: 'Meta Lead Ads Keys' };

/** Settings → Meta Lead Ads Keys (super admin). */
export default async function MetaKeysPage() {
  await requireAdminCan('super');
  return <MetaTab tabs={<SettingsTabs tab="meta" />} />;
}

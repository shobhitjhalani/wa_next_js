import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { requireAiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { saveDoDont } from '../actions';
import { DoDontForm } from './DoDontForm';

export const metadata: Metadata = { title: "Do's & Don'ts" };

/** AI do's and don'ts (User\AiController::doDont, legacy do_dont.php). */
export default async function DoDontPage() {
  const user = await requireAiUser();
  const rows = await query<{ ai_dd_id: number; ai_dd_type: number; ai_content: string | null }>(
    'SELECT ai_dd_id, ai_dd_type, ai_content FROM js_ai_do_dont WHERE ai_user_id = $1 ORDER BY ai_dd_id', [user.u_id]);
  const dos = rows.filter((r) => Number(r.ai_dd_type) === 1).map((r) => r.ai_content ?? '');
  const donts = rows.filter((r) => Number(r.ai_dd_type) === 2).map((r) => r.ai_content ?? '');

  return (
    <>
      <PageTitle title="Do's & Don'ts" home="/dashboard" />
      {/* Remount after a save so the lists show what was stored */}
      <DoDontForm key={rows.map((r) => r.ai_dd_id).join(',')} action={saveDoDont} dos={dos} donts={donts} />
    </>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { requireUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { emptyData, isQrType, sanitizeData, type QrData, type QrType } from '@/lib/quick-reply';
import { QuickReplyEditor } from './QuickReplyEditor';

export const metadata: Metadata = { title: 'Quick Reply' };

/** /quick_replies/new and /quick_replies/{id}: the quick reply editor. */
export default async function QuickReplyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id: raw } = await params;
  const isNew = raw === 'new';
  const id = isNew ? null : Number(raw);
  if (!isNew && !(Number.isInteger(id) && id! > 0)) notFound();

  let initial: { name: string; keywords: string; match: number; type: QrType; data: QrData; active: boolean } = {
    name: '', keywords: '', match: 1, type: 'text', data: emptyData(), active: true,
  };
  if (id) {
    const row = await one<{ qr_name: string; qr_keywords: string[]; qr_match: number; qr_type: string; qr_data: QrData; qr_status: number }>(
      'SELECT qr_name, qr_keywords, qr_match, qr_type, qr_data, qr_status FROM js_quick_reply WHERE qr_id = $1 AND qr_user_id = $2', [id, user.u_id]);
    if (!row) notFound();
    const type = isQrType(row.qr_type) ? row.qr_type : 'text';
    const data = { ...emptyData(), ...sanitizeData(type, row.qr_data) };
    if (!data.buttons.length) data.buttons = ['', ''];
    if (!data.rows.length) data.rows = [{ title: '', description: '' }];
    if (!data.listLabel) data.listLabel = 'Options';
    initial = { name: row.qr_name, keywords: row.qr_keywords.join(', '), match: Number(row.qr_match) || 1, type, data, active: Number(row.qr_status) === 1 };
  }

  return (
    <>
      <PageTitle title={isNew ? 'New Quick Reply' : 'Edit Quick Reply'} home="/dashboard" />
      <QuickReplyEditor id={id} initial={initial} />
    </>
  );
}

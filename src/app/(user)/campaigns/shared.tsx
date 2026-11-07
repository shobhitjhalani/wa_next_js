import { campaignStatusLabel } from '@/lib/format';
import { decodeEntities, jsonParse, numberFormat } from '@/lib/text';
import type { CampaignRow, CampaignStats, MessageRow } from '@/lib/types';

/**
 * Campaign view pieces shared by the list, the detail page and the export:
 * the stacked delivery bar (_bar), status badge (_status), per-recipient
 * status, readable error text and the recipients filter.
 */

/** PHP round($n * 100 / $of, 1) . '%' or an em dash. */
export function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n * 100) / of * 10) / 10}%` : '—';
}

export function barSegments(s: CampaignStats): [key: string, label: string, n: number][] {
  return [
    ['read', 'Read', s.read],
    ['delivered', 'Delivered', s.delivered - s.read],
    ['sent', 'Sent', Math.max(0, s.sent - s.delivered - s.delivery_failed)],
    ['pending', 'Pending', s.pending],
    ['failed', 'Failed', s.failed],
    ['skipped', 'Skipped', s.skipped],
  ];
}

/** Stacked delivery bar for one campaign's stats; segments add up to every recipient. */
export function DeliveryBar({ s, large = false }: { s: CampaignStats; large?: boolean }) {
  const segments = barSegments(s);
  const sum = Math.max(1, segments.reduce((a, [, , n]) => a + n, 0));
  const label = segments.filter(([, , n]) => n > 0).map(([, l, n]) => `${l} ${numberFormat(n)}`).join(', ') || 'No messages yet';
  return (
    <div className={`delivery-bar ${large ? 'lg' : ''}`} role="img" aria-label={label}>
      {segments.map(([key, l, n]) => n > 0 && (
        <span key={key} className={`seg-${key}`} style={{ flex: `${n} 0 0` }} title={`${l}: ${numberFormat(n)} (${Math.round((n * 100) / sum * 10) / 10}%)`} />
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<string, [string, string]> = {
  Scheduled: ['info', 'ri-time-line'],
  Sending: ['warning', 'ri-loader-4-line'],
  Completed: ['success', 'ri-check-double-line'],
  Cancelled: ['secondary', 'ri-close-circle-line'],
  Sent: ['light', 'ri-history-line'],
};

export function StatusBadge({ campaign, s }: { campaign: Pick<CampaignRow, 'uc_status' | 'uc_started_at'>; s: CampaignStats | null }) {
  const label = campaignStatusLabel(campaign, s);
  const [tone, icon] = STATUS_STYLE[label];
  return <span className={`badge bg-${tone}-subtle text-${tone === 'light' ? 'body' : tone}`}><i className={icon} /> {label}</span>;
}

type Recipient = Pick<MessageRow, 'm_status' | 'm_message_id' | 'm_delivery_status'>;

/** Read / Delivered / Sent / Failed / Pending / Skipped for one recipient row. */
export function recipientStatus(m: Recipient): string {
  const status = Number(m.m_status);
  if (status === 1 || status === 6) return 'Pending';
  if (status === 4 || status === 5 || status === 9) return 'Skipped';
  if (String(m.m_message_id ?? '') === '' || m.m_delivery_status === 'failed') return 'Failed';
  if (m.m_delivery_status === 'read') return 'Read';
  if (m.m_delivery_status === 'delivered') return 'Delivered';
  return 'Sent';
}

/** Readable error from the stored API / webhook error payload. */
export function errorText(raw: string | null | undefined): string {
  const text = decodeEntities(raw ?? '');
  const json = jsonParse<unknown>(text, null);
  if (json && typeof json === 'object') {
    const j = json as any;
    const err = j?.[0]?.error ?? j?.error ?? j?.[0] ?? j;
    let out: string | null = err?.message ?? err?.title ?? null;
    const details = err?.error_data?.details;
    if (details) out = `${out ?? ''} — ${details}`.replace(/^[\s—]+|[\s—]+$/g, '');
    return out || 'Unknown error';
  }
  return text !== '' ? text : 'Unknown error';
}

/** WHERE clause over js_message for a campaign's recipients with the status / mobile filters. */
export function recipientWhere(campaignId: number, status: string, mobile: string, params: unknown[]): string {
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  // Rows marked Re-Send (8) were replaced by a new copy, which is the one shown
  const where = [`m_campaign_id = ${p(campaignId)}`, 'm_status <> 8'];
  if (mobile !== '') where.push(`m_mobile_no LIKE ${p('%' + mobile.replace(/\D/g, '') + '%')}`);
  switch (status) {
    case 'pending': where.push('m_status IN (1, 6)'); break;
    case 'skipped': where.push('m_status IN (4, 5, 9)'); break;
    case 'failed': where.push("m_status = 3 AND (COALESCE(m_message_id, '') = '' OR m_delivery_status = 'failed')"); break;
    case 'read':
    case 'delivered': where.push(`m_status = 3 AND m_delivery_status = ${p(status)}`); break;
    case 'sent': where.push("m_status = 3 AND m_message_id <> '' AND (m_delivery_status IS NULL OR m_delivery_status = 'sent')"); break;
  }
  return where.join(' AND ');
}

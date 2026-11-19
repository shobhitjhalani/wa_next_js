import 'server-only';
import { OPEN_STATUSES } from '@/lib/crm';
import { like } from '@/lib/db';
import { sp } from '@/lib/http';
import { addDays, dayStart, now, parseDateRange } from '@/lib/time';

type Params = Record<string, string | string[] | undefined>;

/** Tabs of /crm. `where` uses $1 = user, $2 = end of today, $3 = open statuses. */
export const LEAD_TABS = [
  { key: 'due', label: 'Follow-ups due', dot: 'bg-danger', where: 'l.ld_next_followup > 0 AND l.ld_next_followup < $2 AND l.ld_status = ANY($3::smallint[])' },
  { key: 'upcoming', label: 'Upcoming', dot: 'bg-warning', where: 'l.ld_next_followup >= $2 AND l.ld_status = ANY($3::smallint[])' },
  { key: 'new', label: 'New', dot: 'bg-info', where: 'l.ld_status = 1' },
  { key: 'open', label: 'All open', dot: 'bg-primary', where: 'l.ld_status = ANY($3::smallint[])' },
  { key: 'won', label: 'Won', dot: 'bg-success', where: 'l.ld_status = 4' },
  { key: 'lost', label: 'Lost', dot: 'bg-secondary', where: 'l.ld_status = 5' },
  { key: 'all', label: 'All leads', dot: 'bg-dark', where: 'true' },
] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

/**
 * Filters shared by the list and the CSV export: tab, search (name / mobile / email / campaign),
 * source and the created-on range. Returns the WHERE clause and its parameters ($1…$3 as above).
 */
export function leadFilter(userId: number, params: Params, tab: LeadTab, q: string) {
  const t = now();
  const args: unknown[] = [userId, addDays(dayStart(t), 1), OPEN_STATUSES];
  // $2 / $3 typed in every query: Postgres refuses parameters it cannot type (tabs that don't use them)
  const parts = ['l.ld_user_id = $1', '$2::int > 0', 'cardinality($3::smallint[]) > 0', tab.where];
  if (q) {
    args.push(`%${like(q)}%`);
    const n = args.length;
    parts.push(`(l.ld_name ILIKE $${n} OR l.ld_mobile ILIKE $${n} OR l.ld_email ILIKE $${n} OR l.ld_campaign ILIKE $${n})`);
  }
  const source = sp(params, 'source');
  if (source) { args.push(source); parts.push(`l.ld_source = $${args.length}`); }
  const range = parseDateRange(sp(params, 'created'));
  if (range) { args.push(range[0], range[1]); parts.push(`l.ld_created_on >= $${args.length - 1} AND l.ld_created_on < $${args.length}`); }
  return { where: parts.join(' AND '), args, now: t };
}

/** Count of each tab in one scan (the tab filters only, not the search). */
export function tabCountsSql(): string {
  return `SELECT ${LEAD_TABS.map((tb) => `COUNT(*) FILTER (WHERE ${tb.where})::int AS "${tb.key}"`).join(', ')}
            FROM js_crm_lead l WHERE l.ld_user_id = $1 AND $2::int > 0 AND cardinality($3::smallint[]) > 0`;
}

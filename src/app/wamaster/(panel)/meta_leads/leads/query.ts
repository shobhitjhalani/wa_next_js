import { like } from '@/lib/db';
import { sp } from '@/lib/http';
import { parseDateRange } from '@/lib/time';

export type Params = Record<string, string | string[] | undefined>;

/** Facebook / Instagram leads of every client (index js_crm_lead_fb_idx). */
export const FB_LEAD_SQL = `(l.ld_source IN ('meta_lead_ad', 'facebook', 'instagram') OR l.ld_meta_form_id <> '')`;

export const LEAD_COLS = `l.ld_id, l.ld_user_id, l.ld_name, l.ld_mobile, l.ld_email, l.ld_source, l.ld_campaign, l.ld_status, l.ld_fields,
  l.ld_meta_page_id, l.ld_meta_form_name, l.ld_meta_ad_name, l.ld_meta_campaign_name, l.ld_platform, l.ld_created_on, l.ld_last_followup,
  COALESCE(NULLIF(u.u_company_name, ''), NULLIF(u.u_name, ''), u.u_username::text) AS client,
  COALESCE((SELECT lp_name FROM js_meta_lead_page WHERE lp_page_id = l.ld_meta_page_id), (SELECT fp_name FROM js_fb_page WHERE fp_page_id = l.ld_meta_page_id), '') AS page_name`;

export interface LeadListRow {
  ld_id: number; ld_user_id: number; ld_name: string; ld_mobile: string; ld_email: string; ld_source: string; ld_campaign: string; ld_status: number;
  ld_fields: Record<string, string> | null; ld_meta_page_id: string; ld_meta_form_name: string; ld_meta_ad_name: string; ld_meta_campaign_name: string;
  ld_platform: string; ld_created_on: number; ld_last_followup: number; client: string | null; page_name: string;
}

/** Filters → WHERE (alias l = js_crm_lead, u = js_user) and its arguments. */
export function leadWhere(params: Params): { where: string; args: unknown[]; filters: Record<string, string> } {
  const f = {
    dt: sp(params, 'dt'), user_id: sp(params, 'user_id'), page_id: sp(params, 'page_id'), form: sp(params, 'form'),
    status: sp(params, 'status'), platform: sp(params, 'platform'), q: sp(params, 'q').trim(),
  };
  const args: unknown[] = [];
  const parts = [FB_LEAD_SQL, 'u.u_dstatus = 0'];
  const add = (sql: (n: string) => string, v: unknown) => { args.push(v); parts.push(sql(`$${args.length}`)); };
  const range = parseDateRange(f.dt);
  if (range) { add((n) => `l.ld_created_on >= ${n}`, range[0]); add((n) => `l.ld_created_on < ${n}`, range[1]); }
  if (/^\d+$/.test(f.user_id)) add((n) => `l.ld_user_id = ${n}::int`, Number(f.user_id));
  if (f.page_id === '-') parts.push("l.ld_meta_page_id = ''");
  else if (/^\d+$/.test(f.page_id)) add((n) => `l.ld_meta_page_id = ${n}`, f.page_id);
  if (f.form) add((n) => `l.ld_meta_form_name = ${n}`, f.form);
  if (/^[1-5]$/.test(f.status)) add((n) => `l.ld_status = ${n}::smallint`, Number(f.status));
  if (f.platform === 'fb' || f.platform === 'ig') add((n) => `l.ld_platform = ${n}`, f.platform);
  if (f.q) {
    args.push(`%${like(f.q)}%`);
    const n = `$${args.length}`;
    parts.push(`(l.ld_name ILIKE ${n} OR l.ld_mobile ILIKE ${n} OR l.ld_email ILIKE ${n} OR l.ld_campaign ILIKE ${n})`);
  }
  return { where: parts.join(' AND '), args, filters: f };
}

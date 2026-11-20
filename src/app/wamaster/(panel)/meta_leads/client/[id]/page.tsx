import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { requireSuperAdmin } from '@/lib/admin-access';
import { one, query } from '@/lib/db';
import { cleanLocations, locationLabel, type Question } from '@/lib/meta-ad-form';
import type { ClientConfig } from '@/lib/meta-leads';
import { template } from '@/lib/services/meta-leads';
import { USER_TYPE } from '@/lib/types';
import { ClientForm, type ClientValues } from '../../Forms';

export const metadata: Metadata = { title: 'Meta Lead Ads client' };

/** Add / edit one client's Meta Lead Ads settings (/wamaster/meta_leads/client/new or /<user id>). */
export default async function MetaClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const isNew = id === 'new';
  const userId = isNew ? 0 : Number(id);
  if (!isNew && !(userId > 0)) notFound();
  const [c, tpl, clients, pages, members] = await Promise.all([
    isNew ? null : one<ClientConfig>('SELECT * FROM js_meta_client_config WHERE mc_user_id = $1', [userId]),
    template(),
    query<{ id: number; name: string }>(
      `SELECT u_id AS id, COALESCE(NULLIF(u_company_name, ''), NULLIF(u_name, ''), u_username::text) || ' (' || u_username || ')' || CASE WHEN u_crm = 1 THEN '' ELSE ' · CRM off' END AS name
         FROM js_user WHERE u_dstatus = 0 AND u_type = $1 AND (u_ads = 1 OR u_id = $3) AND ($2 OR u_id NOT IN (SELECT mc_user_id FROM js_meta_client_config))
        ORDER BY lower(COALESCE(NULLIF(u_company_name, ''), u_name, u_username::text))`, [USER_TYPE.WHATSAPP, !isNew, userId]),
    query<{ id: string; name: string }>('SELECT fp_page_id AS id, fp_name AS name FROM js_fb_page ORDER BY lower(fp_name)'),
    isNew ? [] : query<{ id: number; name: string }>('SELECT um_id AS id, um_name AS name FROM js_user_member WHERE um_user_id = $1 AND um_status = 1 ORDER BY lower(um_name)', [userId]),
  ]);
  if (!isNew && !c && !clients.some((x) => x.id === userId)) notFound();

  const v: ClientValues = {
    user_id: isNew ? '' : String(userId),
    ad_account_id: c?.mc_ad_account_id ?? '', page_id: c?.mc_page_id ?? '', privacy_policy_url: c?.mc_privacy_policy_url ?? '',
    website_url: c?.mc_website_url ?? '', image_url: c?.mc_image_url ?? '',
    daily_budget: c?.mc_daily_budget ? String(c.mc_daily_budget / 100) : '', countries: c?.mc_countries?.join(', ') ?? '',
    age_min: c?.mc_age_min ? String(c.mc_age_min) : '', age_max: c?.mc_age_max ? String(c.mc_age_max) : '',
    headline: c?.mc_headline ?? '', primary_text: c?.mc_primary_text ?? '', cta: c?.mc_cta ?? '',
    special_ad_categories: c?.mc_special_ad_categories ? (c.mc_special_ad_categories.length ? c.mc_special_ad_categories.join(', ') : 'NONE') : '',
    country_code: c?.mc_country_code ?? 'IN', assignee: String(c?.mc_assignee ?? 0), is_active: c ? c.mc_is_active === 1 : true,
    questions: Array.isArray(c?.mc_questions) && c.mc_questions.length ? c.mc_questions as Question[] : null,
    locations: cleanLocations(c?.mc_locations),
  };
  const tplPlaces = cleanLocations(tpl.mt_locations);
  const name = clients.find((x) => x.id === userId)?.name;

  return (
    <>
      <PageTitle title={isNew ? 'Add Meta Lead Ads client' : `Meta Lead Ads · ${name ?? `#${userId}`}`} home="/wamaster/dashboard" />
      <div className="mb-3"><Link href="/wamaster/meta_leads" className="text-muted"><i className="ri-arrow-left-line align-middle" /> Meta Lead Ads</Link></div>
      <div className="card">
        <div className="card-body">
          <ClientForm v={v} isNew={isNew} clients={clients} pages={pages} members={members}
            template={{
              budget: String(tpl.mt_daily_budget / 100), countries: tpl.mt_countries.join(', '), ages: `${tpl.mt_age_min}–${tpl.mt_age_max}`,
              headline: tpl.mt_headline, primary: tpl.mt_primary_text.slice(0, 80), cta: tpl.mt_cta,
              area: tplPlaces.length ? tplPlaces.map(locationLabel).join('; ') : tpl.mt_countries.join(', '),
              questions: Array.isArray(tpl.mt_questions) ? tpl.mt_questions as Question[] : [],
            }} />
        </div>
      </div>
    </>
  );
}

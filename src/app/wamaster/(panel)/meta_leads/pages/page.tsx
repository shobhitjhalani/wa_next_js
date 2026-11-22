import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { requireSuperAdmin } from '@/lib/admin-access';
import { url } from '@/lib/config';
import { query } from '@/lib/db';
import { pageLeadCounts, pageNames, savedPages, tokenPages } from '@/lib/services/lead-pages';
import { tokenSource } from '@/lib/services/meta-leads';
import { USER_TYPE } from '@/lib/types';
import { MetaLeadsTabs } from '../Tabs';
import { PagesTable, type PageRow } from './PagesTable';

export const metadata: Metadata = { title: 'Lead Pages' };

/** Facebook Pages whose leads go to a client's Leads CRM (super admin). */
export default async function LeadPagesPage() {
  await requireSuperAdmin();
  const [fromToken, saved, counts, clients, tokenFrom] = await Promise.all([
    tokenPages(),
    savedPages(),
    pageLeadCounts(),
    query<{ u_id: number; name: string; u_username: string | null; u_crm: number }>(
      `SELECT u_id, COALESCE(NULLIF(u_company_name, ''), NULLIF(u_name, ''), u_username::text, '#' || u_id) AS name, u_username, u_crm
         FROM js_user WHERE u_dstatus = 0 AND u_type = $1 ORDER BY lower(COALESCE(NULLIF(u_company_name, ''), u_name, ''))`, [USER_TYPE.WHATSAPP]),
    tokenSource(),
  ]);

  // Token Pages + saved Pages + Pages that sent leads nobody received
  const byId = new Map<string, PageRow>();
  const blank = (id: string): PageRow => ({ id, name: '', category: '', inToken: false, saved: false, userId: 0, client: null, subscribed: false, error: '', recent: 0, waiting: 0 });
  for (const p of fromToken.pages) byId.set(p.id, { ...blank(p.id), name: p.name, category: p.category, inToken: true });
  for (const s of saved) {
    const row = byId.get(s.lp_page_id) ?? blank(s.lp_page_id);
    byId.set(s.lp_page_id, { ...row, name: row.name || s.lp_name, saved: true, userId: s.lp_user_id, client: s.client, subscribed: s.lp_subscribed === 1, error: s.lp_error });
  }
  for (const [id, c] of counts) {
    if (!byId.has(id) && c.waiting > 0) byId.set(id, blank(id));
    const row = byId.get(id);
    if (row) Object.assign(row, c);
  }
  const unnamed = [...byId.values()].filter((p) => !p.name).map((p) => p.id);
  const names = await pageNames(unnamed);
  for (const id of unnamed) byId.get(id)!.name = names.get(id) ?? '';
  // Connected first, then waiting leads, then by name
  const pages = [...byId.values()].sort((a, b) => Number(b.saved) - Number(a.saved) || b.waiting - a.waiting || a.name.localeCompare(b.name));

  const options = [
    { value: '', label: '— Not assigned (leads wait) —' },
    ...clients.map((c) => ({ value: String(c.u_id), label: `${c.name}${c.u_username && c.u_username !== c.name ? ` (${c.u_username})` : ''}${Number(c.u_crm) === 1 ? '' : ' · Leads CRM off'}` })),
  ];
  const waiting = pages.reduce((a, p) => a + (p.saved && p.userId ? 0 : p.waiting), 0);

  return (
    <>
      <PageTitle title="Lead Pages" home="/wamaster/dashboard" />
      <MetaLeadsTabs tab="pages" />
      {tokenFrom === 'none' && (
        <div className="alert alert-warning">No Meta token is set. Add the System User token in <Link href="/wamaster/settings/meta">Settings → Meta Lead Ads Keys</Link> to list your Pages.</div>
      )}
      {fromToken.error && tokenFrom !== 'none' && <div className="alert alert-danger">Could not list the Pages of the Meta token: {fromToken.error}</div>}
      {waiting > 0 && (
        <div className="alert alert-warning"><i className="ri-time-line me-1" /><b>{waiting}</b> lead(s) are waiting for a client. Choose the client on their Page and they are filed in that client&apos;s Leads CRM.</div>
      )}
      <div className="card">
        <PagesTable pages={pages} clients={options} />
      </div>
      <div className="card">
        <div className="card-body small">
          <h6>How it works</h6>
          <ul className="mb-0 ps-3">
            <li>The list shows every Page the System User token can reach (assign Pages to the System User in Business Settings to see more).</li>
            <li><b>Connect</b> subscribes our Meta app to the Page&apos;s leads. Each new lead from any form or ad of the Page goes to the chosen client&apos;s Leads CRM, and shows here under <Link href="/wamaster/meta_leads/leads">Facebook Leads</Link>.</li>
            <li>A client can have several Pages. Leads of a Page without a client are kept and filed as soon as you choose one.</li>
            <li>Missed webhooks are picked up every 30 minutes from the Pages&apos; lead forms (leads after the Page was connected).</li>
            <li>The Meta app&apos;s Page webhook must point to <code>{url('/integrations/meta/webhook')}</code> with the field <code>leadgen</code>.</li>
            <li>The client sees the leads only when <b>Leads CRM</b> is on in their Permissions.</li>
          </ul>
        </div>
      </div>
    </>
  );
}

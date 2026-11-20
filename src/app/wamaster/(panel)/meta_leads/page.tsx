import type { Metadata } from 'next';
import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireSuperAdmin } from '@/lib/admin-access';
import { config, url } from '@/lib/config';
import { query } from '@/lib/db';
import { cleanLocations, locationLabel, type Question } from '@/lib/meta-ad-form';
import { adsManagerLinks, mergeSettings, settingsProblems, type ClientConfig } from '@/lib/meta-leads';
import { template, tokenSource, webhookHealth } from '@/lib/services/meta-leads';
import { META_KEYS, metaSettingsStatus, type MetaKey } from '@/lib/services/meta-settings';
import { phpDate } from '@/lib/time';
import { AccordionCard } from '../fb_posts/Forms';
import { activateAd, createAd, createAds, deleteClient, retryAllEvents, retryEvent } from './actions';
import { BulkCreate, CopyText, TemplateForm } from './Forms';
import { STATUS_BADGE } from './options';

export const metadata: Metadata = { title: 'Meta Lead Ads' };

interface ClientRow extends ClientConfig { client: string; crm: number; page_name: string | null; assignee_name: string | null }
interface AssetRow {
  ma_id: number; ma_user_id: number; ma_ad_account_id: string; ma_page_id: string; ma_subscribed: number; ma_form_id: string; ma_campaign_id: string;
  ma_image_hash: string; ma_adset_id: string; ma_creative_id: string; ma_ad_id: string; ma_status: string; ma_note: string; ma_last_error: string;
  ma_campaign_name: string; ma_updated_at: number; leads: number;
}
interface EventRow { me_id: number; me_leadgen_id: string; me_page_id: string; me_attempts: number; me_error: string; me_updated_at: number; me_next_attempt_at: number; client: string | null }

const money = (minor: number) => (minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Agency: the common lead ad for every client (template, per-client settings, create / activate) and the leadgen webhook health. */
export default async function MetaLeadsPage() {
  await requireSuperAdmin();
  const [tpl, clients, assets, failed, health, tokenFrom] = await Promise.all([
    template(),
    query<ClientRow>(
      `SELECT c.*, COALESCE(NULLIF(u.u_company_name, ''), NULLIF(u.u_name, ''), u.u_username::text) AS client, u.u_crm AS crm,
              (SELECT fp_name FROM js_fb_page WHERE fp_page_id = c.mc_page_id LIMIT 1) AS page_name,
              (SELECT um_name FROM js_user_member WHERE um_id = c.mc_assignee) AS assignee_name
         FROM js_meta_client_config c JOIN js_user u ON u.u_id = c.mc_user_id ORDER BY lower(COALESCE(NULLIF(u.u_company_name, ''), u.u_name, ''))`),
    query<AssetRow>(
      `SELECT DISTINCT ON (a.ma_user_id) a.*,
              (SELECT COUNT(*)::int FROM js_meta_lead_events e WHERE e.me_form_id = a.ma_form_id AND a.ma_form_id <> '' AND e.me_status = 'synced') AS leads
         FROM js_meta_campaign_assets a ORDER BY a.ma_user_id, a.ma_id DESC`),
    query<EventRow>(
      `SELECT e.me_id, e.me_leadgen_id, e.me_page_id, e.me_attempts, e.me_error, e.me_updated_at, e.me_next_attempt_at,
              (SELECT COALESCE(NULLIF(u.u_company_name, ''), u.u_name) FROM js_meta_client_config c JOIN js_user u ON u.u_id = c.mc_user_id WHERE c.mc_page_id = e.me_page_id LIMIT 1) AS client
         FROM js_meta_lead_events e WHERE e.me_status = 'failed' ORDER BY e.me_id DESC LIMIT 100`),
    webhookHealth(),
    tokenSource(),
  ]);
  const byUser = new Map(assets.map((a) => [a.ma_user_id, a]));
  const hookUrl = url('/integrations/meta/webhook');
  const keys = await metaSettingsStatus();
  const from = (k: MetaKey) => (keys[k].source === 'settings' ? 'Settings' : keys[k].source === 'env' ? `.env (${META_KEYS[k].env})` : '');
  const checks: [string, boolean, string][] = [
    ['System User token', tokenFrom !== 'none', tokenFrom === 'env' ? from('systemUserToken') : tokenFrom === 'saved' ? 'the token saved on Facebook Pages' : 'enter it in Settings → Meta Lead Ads Keys'],
    ['App secret (signature check)', !!config.metaAds.appSecret, config.metaAds.appSecret ? from('appSecret') : 'enter it in Settings → Meta Lead Ads Keys: every webhook is refused until then'],
    ['Verify token', !!config.metaAds.webhookVerifyToken, config.metaAds.webhookVerifyToken ? from('webhookVerifyToken') : 'enter it in Settings → Meta Lead Ads Keys'],
  ];
  const tv = {
    campaign_name: tpl.mt_campaign_name, form_name: tpl.mt_form_name, questions: Array.isArray(tpl.mt_questions) ? tpl.mt_questions as Question[] : [], locations: cleanLocations(tpl.mt_locations),
    privacy_link_text: tpl.mt_privacy_link_text, thank_you_title: tpl.mt_thank_you_title, thank_you_body: tpl.mt_thank_you_body,
    thank_you_button: tpl.mt_thank_you_button, locale: tpl.mt_locale, countries: tpl.mt_countries.join(', '), age_min: String(tpl.mt_age_min),
    age_max: String(tpl.mt_age_max), daily_budget: String(tpl.mt_daily_budget / 100), headline: tpl.mt_headline, primary_text: tpl.mt_primary_text,
    cta: tpl.mt_cta, special_ad_categories: tpl.mt_special_ad_categories.join(', '),
  };

  return (
    <>
      <PageTitle title="Meta Lead Ads" home="/wamaster/dashboard" />
      <div className="row">
        <div className="col-xl-4">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><i className="ri-pulse-line text-primary" /> Webhook health</h5></div>
            <div className="card-body">
              <div className="small text-muted mb-1">Callback URL (Meta App → Webhooks → Page → <code>leadgen</code>)</div>
              <div className="d-flex gap-2 align-items-center mb-3"><code className="text-break small flex-grow-1">{hookUrl}</code><CopyText text={hookUrl} /></div>
              <ul className="list-unstyled small mb-3">
                {checks.map(([label, good, note]) => (
                  <li key={label} className="mb-1"><i className={good ? 'ri-checkbox-circle-fill text-success' : 'ri-close-circle-fill text-danger'} /> {label}: <span className={good ? 'text-muted' : 'text-danger'}>{note}</span></li>
                ))}
                <li className="text-muted"><i className="ri-information-line" /> Graph API: {config.metaAds.graphUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '')}</li>
              </ul>
              <div className="row g-2 text-center mb-2">
                {([['Received', health.received, 'info'], ['Synced', health.synced, 'success'], ['Failed', health.failed, 'danger'], ['Ignored', health.ignored, 'secondary']] as const).map(([l, n, c]) => (
                  <div key={l} className="col-3"><div className={`border rounded py-2 bg-${c}-subtle`}><div className={`fs-5 fw-semibold text-${c}`}>{n}</div><div className="small text-muted">{l}</div></div></div>
                ))}
              </div>
              <div className="small text-muted">
                {health.lastWebhookAt ? <>Last webhook {phpDate('d M Y, h:i A', health.lastWebhookAt)}</> : 'No webhook received yet'} · {health.day} lead(s) in the last 24 h.
                {' '}Missed ones are fetched every 30 minutes.
              </div>
            </div>
          </div>
        </div>
        <div className="col-xl-8">
          <AccordionCard title={<><i className="ri-file-copy-2-line text-primary me-1" />Common template</>}
            actions={tpl.mt_updated_on ? <span className="small text-muted">Saved {phpDate('d M Y', tpl.mt_updated_on)}</span> : undefined}>
            <p className="small text-muted">Every client’s ad uses these values unless its own settings fill them in.</p>
            <TemplateForm v={tv} />
          </AccordionCard>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center gap-2">
          <h5 className="card-title mb-0 me-auto">Clients <span className="text-muted fw-normal small">({clients.length})</span></h5>
          {clients.length > 0 && <BulkCreate action={createAds} />}
          <Link href="/wamaster/meta_leads/client/new" className="btn btn-sm btn-soft-primary"><i className="ri-add-line" /> Add client</Link>
        </div>
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 32 }}><input type="checkbox" className="form-check-input" id="ml-all" aria-label="Select all clients" /></th>
                  <th>Client</th><th>Page · Ad account</th><th>Budget / day</th><th>Lead ad</th><th className="text-end">Leads</th><th />
                </tr>
              </thead>
              <tbody>
                {clients.length ? clients.map((c) => {
                  const s = mergeSettings(tpl, c, c.client);
                  const missing = settingsProblems(s);
                  const a = byUser.get(c.mc_user_id);
                  const st = a ? STATUS_BADGE[a.ma_status] ?? { label: a.ma_status, badge: 'bg-light text-body' } : null;
                  const links = a ? adsManagerLinks(a.ma_ad_account_id, { campaignId: a.ma_campaign_id, adsetId: a.ma_adset_id, adId: a.ma_ad_id, pageId: a.ma_form_id ? a.ma_page_id : '' }) : null;
                  const busy = a && ['queued', 'running', 'activating'].includes(a.ma_status);
                  return (
                    <tr key={c.mc_user_id}>
                      <td><input type="checkbox" className="form-check-input" form="ml-bulk" name="ids" value={c.mc_user_id} aria-label={`Select ${c.client}`} disabled={!c.mc_is_active || missing.length > 0} /></td>
                      <td>
                        <Link href={`/wamaster/meta_leads/client/${c.mc_user_id}`} className="fw-semibold">{c.client}</Link>
                        <div className="small">
                          {!c.mc_is_active && <span className="badge bg-secondary-subtle text-secondary me-1">Off</span>}
                          {Number(c.crm) !== 1 && <span className="badge bg-warning-subtle text-warning me-1" title="Leads are saved, but the client only sees them once Leads CRM is switched on for the account">CRM off</span>}
                          {c.assignee_name && <span className="text-muted">Leads → {c.assignee_name}</span>}
                        </div>
                        {missing.length > 0 && <div className="small text-danger">Missing: {missing.join(', ')}</div>}
                      </td>
                      <td className="small">
                        <a href={`https://www.facebook.com/${s.pageId}`} target="_blank" rel="noreferrer">{c.page_name ?? s.pageId}</a>
                        <div className="text-muted">{s.adAccountId}</div>
                      </td>
                      <td className="small">{money(s.dailyBudget)}<div className="text-muted">{s.locations.length ? <span title={s.locations.map(locationLabel).join('\n')}>{s.locations.length === 1 ? locationLabel(s.locations[0]) : `${s.locations.length} places`}</span> : s.countries.join(', ')} · {s.ageMin}–{s.ageMax}</div></td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        {a && st ? (
                          <>
                            <span className={`badge ${st.badge}`}>{st.label}</span> <span className="text-muted">{phpDate('d M, h:i A', a.ma_updated_at)}</span>
                            <div className="d-flex flex-wrap gap-2 mt-1">
                              {([['Page subscribed', !!a.ma_subscribed, ''], ['Form', !!a.ma_form_id, links!.form], ['Campaign', !!a.ma_campaign_id, links!.campaign],
                                ['Ad set', !!a.ma_adset_id, links!.adset], ['Creative', !!a.ma_creative_id, ''], ['Ad', !!a.ma_ad_id, links!.ad]] as const).map(([l, ok, href]) => (
                                <span key={l} className={ok ? 'text-success' : 'text-muted'}>
                                  <i className={ok ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} />{' '}
                                  {ok && href ? <a href={href} target="_blank" rel="noreferrer">{l}</a> : l}
                                </span>
                              ))}
                            </div>
                            {a.ma_last_error && <div className="text-danger mt-1 text-break">{a.ma_last_error}</div>}
                            {a.ma_note && <div className="text-warning mt-1">{a.ma_note}</div>}
                          </>
                        ) : <span className="text-muted">Not created yet</span>}
                      </td>
                      <td className="text-end">{a?.leads ?? 0}</td>
                      <td className="text-end text-nowrap">
                        <div className="d-inline-flex gap-1">
                          {!busy && c.mc_is_active === 1 && missing.length === 0 && (!a || a.ma_status === 'failed') && (
                            <form action={createAd.bind(null, c.mc_user_id)}>
                              <ConfirmButton message={a ? `Resume creating the lead ad for ${c.client} from the step that failed?` : `Create the common lead ad for ${c.client}? Everything is created PAUSED.`}
                                className="btn btn-sm btn-primary">{a ? <><i className="ri-restart-line" /> Resume</> : <><i className="ri-megaphone-line" /> Create</>}</ConfirmButton>
                            </form>
                          )}
                          {a?.ma_status === 'paused' && a.ma_ad_id && (
                            <form action={activateAd.bind(null, a.ma_id)}>
                              <ConfirmButton message={`Activate the lead ad for ${c.client}? The campaign, ad set and ad go live and start spending up to ${money(s.dailyBudget)} a day.`}
                                className="btn btn-sm btn-success"><i className="ri-play-circle-line" /> Activate</ConfirmButton>
                            </form>
                          )}
                          {a && ['paused', 'active'].includes(a.ma_status) && c.mc_is_active === 1 && missing.length === 0 && (
                            <form action={createAd.bind(null, c.mc_user_id)}>
                              <ConfirmButton message={`Create another (new) lead ad for ${c.client}? The existing one stays as it is.`} className="btn btn-sm btn-soft-primary" title="Create a new lead ad"><i className="ri-add-line" /></ConfirmButton>
                            </form>
                          )}
                          <Link href={`/wamaster/meta_leads/client/${c.mc_user_id}`} className="btn btn-sm btn-soft-secondary" title="Edit settings"><i className="ri-pencil-line" /></Link>
                          <form action={deleteClient.bind(null, c.mc_user_id)}>
                            <ConfirmButton message={`Remove ${c.client} from Meta Lead Ads? Ads already on Meta are not touched, but its new leads are no longer saved.`} className="btn btn-sm btn-soft-danger" title="Remove"><i className="ri-delete-bin-line" /></ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan={7} className="text-center text-muted py-4">No clients yet. <Link href="/wamaster/meta_leads/client/new">Add the first client</Link>.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="small text-muted mt-2 mb-0">
            <b>Create</b> makes, in this order: the Page’s leadgen subscription, the lead form, the campaign, the ad set, the creative and the ad, all <b>paused</b>.
            If a step fails, the error shows here and <b>Resume</b> continues from that step. Nothing is spent until you <b>Activate</b>.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex align-items-center gap-2">
          <h5 className="card-title mb-0 me-auto">Failed leads <span className="text-muted fw-normal small">({failed.length})</span></h5>
          {failed.length > 0 && <form action={retryAllEvents}><ConfirmButton message="Try every failed lead again?" className="btn btn-sm btn-soft-primary"><i className="ri-restart-line" /> Retry all</ConfirmButton></form>}
        </div>
        <div className="card-body">
          {failed.length ? (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light"><tr><th>Lead id</th><th>Client / Page</th><th>Tries</th><th>Error</th><th>Next try</th><th /></tr></thead>
                <tbody>
                  {failed.map((e) => (
                    <tr key={e.me_id}>
                      <td className="small font-monospace">{e.me_leadgen_id}</td>
                      <td className="small">{e.client ?? <span className="text-muted">—</span>}<div className="text-muted">{e.me_page_id}</div></td>
                      <td>{e.me_attempts}</td>
                      <td className="small text-danger text-break" style={{ maxWidth: 380 }}>{e.me_error}</td>
                      <td className="small text-muted">{e.me_next_attempt_at >= 2147483647 ? 'Gave up after 5 tries' : phpDate('d M, h:i A', e.me_next_attempt_at)}</td>
                      <td className="text-end"><form action={retryEvent.bind(null, e.me_id)}><button className="btn btn-sm btn-soft-primary"><i className="ri-restart-line" /> Retry</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted small mb-0">None. Leads that fail are tried again after 1, 5, 15 and 60 minutes, then listed here.</p>}
        </div>
      </div>
    </>
  );
}

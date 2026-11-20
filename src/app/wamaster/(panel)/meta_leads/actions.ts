'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { flash, fStr, invalid, ok, type ActionResult } from '@/lib/actions';
import { logActivity } from '@/lib/activity';
import { requireSuperAdmin } from '@/lib/admin-access';
import { exec, one } from '@/lib/db';
import { cleanLocations, questionsProblem, withKeys, type FoundLocation, type Question } from '@/lib/meta-ad-form';
import { MetaError } from '@/lib/meta-graph';
import { requestActivate, requestProvision, retryEvents, searchLocations } from '@/lib/services/meta-leads';
import { now } from '@/lib/time';
import { CTAS, SPECIAL_CATEGORIES } from './options';

const PATH = '/wamaster/meta_leads';

const list = (v: string) => [...new Set(v.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);

/** Rupees (or the account currency) with up to 2 decimals → minor units; null when empty, NaN when invalid. */
function minorUnits(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN;
}

/** The questions editor's JSON → [keyed questions, error]. */
function readQuestions(raw: string): [Question[], string] {
  let v: unknown;
  try { v = JSON.parse(raw || '[]'); } catch { return [[], 'This is not valid JSON.']; }
  const problem = questionsProblem(v);
  return problem ? [[], problem] : [withKeys(v as Question[]), ''];
}

/** The area editor's JSON → valid places. */
function readLocations(raw: string) {
  try { return cleanLocations(JSON.parse(raw || '[]')); } catch { return []; }
}

function age(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 13 && n <= 65 ? n : NaN;
}

/** The common template every client falls back to. */
export async function saveTemplate(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const errors: Record<string, string> = {};
  const [questions, qProblem] = readQuestions(fStr(fd, 'questions'));
  if (qProblem) errors.questions = qProblem;
  const locations = readLocations(fStr(fd, 'locations'));
  const budget = minorUnits(fStr(fd, 'daily_budget'));
  const ageMin = age(fStr(fd, 'age_min')), ageMax = age(fStr(fd, 'age_max'));
  const countries = list(fStr(fd, 'countries'));
  const special = list(fStr(fd, 'special_ad_categories'));
  const cta = fStr(fd, 'cta') || 'SIGN_UP';
  if (!fStr(fd, 'campaign_name')) errors.campaign_name = 'Enter the campaign name pattern.';
  if (!fStr(fd, 'form_name')) errors.form_name = 'Enter the form name pattern.';
  if (budget === null || Number.isNaN(budget)) errors.daily_budget = 'Enter the daily budget, e.g. 500.';
  if (ageMin === null || Number.isNaN(ageMin)) errors.age_min = '13 to 65.';
  if (ageMax === null || Number.isNaN(ageMax)) errors.age_max = '13 to 65.';
  if (ageMin && ageMax && ageMin > ageMax) errors.age_max = 'Must not be below the minimum age.';
  if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) errors.countries = 'Two-letter country codes, e.g. IN, AE.';
  else if (!countries.length && !locations.length) errors.countries = 'Enter the countries or add local places below.';
  if (special.some((c) => !SPECIAL_CATEGORIES.some((s) => s.value === c))) errors.special_ad_categories = 'Unknown category.';
  if (!CTAS.includes(cta)) errors.cta = 'Choose a button.';
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(fStr(fd, 'locale'))) errors.locale = 'e.g. en_US, hi_IN.';
  if (Object.keys(errors).length) return invalid(errors);
  await exec(
    `UPDATE js_meta_lead_template SET mt_campaign_name = $1, mt_form_name = $2, mt_questions = $3, mt_privacy_link_text = $4,
            mt_thank_you_title = $5, mt_thank_you_body = $6, mt_thank_you_button = $7, mt_locale = $8, mt_countries = $9,
            mt_age_min = $10, mt_age_max = $11, mt_daily_budget = $12, mt_headline = $13, mt_primary_text = $14, mt_cta = $15,
            mt_special_ad_categories = $16, mt_updated_on = $17, mt_locations = $18 WHERE mt_id = 1`,
    [fStr(fd, 'campaign_name').slice(0, 200), fStr(fd, 'form_name').slice(0, 200), JSON.stringify(questions), fStr(fd, 'privacy_link_text').slice(0, 70) || 'Privacy Policy',
      fStr(fd, 'thank_you_title').slice(0, 60), fStr(fd, 'thank_you_body').slice(0, 500), fStr(fd, 'thank_you_button').slice(0, 30) || 'Visit website',
      fStr(fd, 'locale'), countries, ageMin, ageMax, budget, fStr(fd, 'headline').slice(0, 255), fStr(fd, 'primary_text').slice(0, 2000), cta, special, now(), JSON.stringify(locations)]);
  await logActivity({ module: 'meta_leads', action: 'Saved the common lead ad template', details: [`Questions: ${(questions as unknown[]).length}`, `Daily budget: ${(budget ?? 0) / 100}`] });
  revalidatePath(PATH);
  return ok('Template saved. Ads created from now on use it (ads already created are not changed).');
}

/** One client's settings (empty fields use the template). */
export async function saveClient(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireSuperAdmin();
  const userId = Number(fStr(fd, 'user_id'));
  const errors: Record<string, string> = {};
  const user = userId > 0 ? await one<{ u_id: number; u_ads: number }>('SELECT u_id, u_ads FROM js_user WHERE u_id = $1 AND u_dstatus = 0', [userId]) : null;
  if (!user) errors.user_id = 'Choose the client account.';
  else if (Number(user.u_ads) !== 1 && fStr(fd, 'is_active') === '1') errors.user_id = 'Switch on Ads Management for this account first (Users → Edit → Permissions).';
  const act = fStr(fd, 'ad_account_id').replace(/^act_/, '');
  const page = fStr(fd, 'page_id');
  if (!/^\d{5,25}$/.test(act)) errors.ad_account_id = 'The ad account id: digits, with or without act_.';
  if (!/^\d{5,25}$/.test(page)) errors.page_id = 'The Facebook Page id (digits).';
  for (const k of ['privacy_policy_url', 'website_url', 'image_url']) if (!isUrl(fStr(fd, k))) errors[k] = 'A full https:// link.';
  const budget = minorUnits(fStr(fd, 'daily_budget'));
  if (Number.isNaN(budget)) errors.daily_budget = 'A positive amount, e.g. 500.';
  const ageMin = age(fStr(fd, 'age_min')), ageMax = age(fStr(fd, 'age_max'));
  if (Number.isNaN(ageMin)) errors.age_min = '13 to 65, or empty.';
  if (Number.isNaN(ageMax)) errors.age_max = '13 to 65, or empty.';
  if (ageMin && ageMax && ageMin > ageMax) errors.age_max = 'Must not be below the minimum age.';
  const countries = list(fStr(fd, 'countries'));
  if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) errors.countries = 'Two-letter country codes, e.g. IN, AE.';
  const special = fStr(fd, 'special_ad_categories').trim() ? list(fStr(fd, 'special_ad_categories')).filter((c) => c !== 'NONE') : null;
  if (special?.some((c) => !SPECIAL_CATEGORIES.some((s) => s.value === c))) errors.special_ad_categories = 'Unknown category.';
  const cta = fStr(fd, 'cta');
  if (cta && !CTAS.includes(cta)) errors.cta = 'Choose a button.';
  const ownQuestions = fStr(fd, 'own_questions') === '1';
  const [questions, qProblem] = ownQuestions ? readQuestions(fStr(fd, 'questions')) : [[], ''];
  if (qProblem) errors.questions = qProblem;
  const locations = readLocations(fStr(fd, 'locations'));
  const country = fStr(fd, 'country_code').toUpperCase() || 'IN';
  if (!/^[A-Z]{2}$/.test(country)) errors.country_code = 'Two letters, e.g. IN.';
  const assignee = Number(fStr(fd, 'assignee')) || 0;
  if (assignee && user && !(await one('SELECT 1 FROM js_user_member WHERE um_id = $1 AND um_user_id = $2', [assignee, userId]))) errors.assignee = 'Not a team member of this client.';
  const clash = user ? await one<{ name: string }>(
    `SELECT COALESCE(NULLIF(u.u_company_name, ''), u.u_name, u.u_username::text) AS name FROM js_meta_client_config c JOIN js_user u ON u.u_id = c.mc_user_id
      WHERE c.mc_page_id = $1 AND c.mc_user_id <> $2 AND c.mc_is_active = 1`, [page, userId]) : null;
  if (clash && fStr(fd, 'is_active') === '1') errors.page_id = `This Page is already used by ${clash.name}: its leads could only go to one client.`;
  if (Object.keys(errors).length) return invalid(errors);

  await exec(
    `INSERT INTO js_meta_client_config (mc_user_id, mc_ad_account_id, mc_page_id, mc_privacy_policy_url, mc_website_url, mc_image_url, mc_daily_budget,
            mc_countries, mc_age_min, mc_age_max, mc_headline, mc_primary_text, mc_cta, mc_special_ad_categories, mc_country_code, mc_assignee, mc_is_active, mc_updated_on, mc_questions, mc_locations)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (mc_user_id) DO UPDATE SET mc_ad_account_id = $2, mc_page_id = $3, mc_privacy_policy_url = $4, mc_website_url = $5, mc_image_url = $6,
            mc_daily_budget = $7, mc_countries = $8, mc_age_min = $9, mc_age_max = $10, mc_headline = $11, mc_primary_text = $12, mc_cta = $13,
            mc_special_ad_categories = $14, mc_country_code = $15, mc_assignee = $16, mc_is_active = $17, mc_updated_on = $18,
            mc_questions = $19, mc_locations = $20`,
    [userId, `act_${act}`, page, fStr(fd, 'privacy_policy_url'), fStr(fd, 'website_url'), fStr(fd, 'image_url'), budget,
      countries.length ? countries : null, ageMin, ageMax, fStr(fd, 'headline').slice(0, 255), fStr(fd, 'primary_text').slice(0, 2000), cta,
      special, country, assignee, fStr(fd, 'is_active') === '1' ? 1 : 0, now(),
      ownQuestions ? JSON.stringify(questions) : null, locations.length ? JSON.stringify(locations) : null]);
  await logActivity({ module: 'meta_leads', action: 'Saved Meta Lead Ads client', target: `Account #${userId}`, targetId: userId,
    details: [`Ad account act_${act}`, `Page ${page}`, fStr(fd, 'is_active') === '1' ? 'Active' : 'Off'] });
  await flash('success', 'Client settings saved.');
  revalidatePath(PATH);
  redirect(PATH);
}

/** The target area editor's place search (Meta's location search with the System User token). */
export async function searchPlaces(q: string, countryCode: string): Promise<{ results: FoundLocation[]; error: string }> {
  await requireSuperAdmin();
  const text = String(q ?? '').trim().slice(0, 100);
  if (text.length < 2) return { results: [], error: 'Type at least 2 letters.' };
  try {
    return { results: await searchLocations(text, String(countryCode ?? '').toUpperCase()), error: '' };
  } catch (e) {
    return { results: [], error: e instanceof MetaError ? `Meta: ${e.describe()}` : 'The search failed; try again.' };
  }
}

export async function deleteClient(userId: number): Promise<void> {
  await requireSuperAdmin();
  await exec('DELETE FROM js_meta_client_config WHERE mc_user_id = $1', [userId]);
  await logActivity({ module: 'meta_leads', action: 'Removed Meta Lead Ads client', target: `Account #${userId}`, targetId: userId });
  await flash('success', 'Client removed from Meta Lead Ads (ads already on Meta are not touched; its new leads are no longer saved).');
  revalidatePath(PATH);
}

async function queue(ids: number[]): Promise<void> {
  const { admin } = await requireSuperAdmin();
  if (!ids.length) {
    await flash('error', 'Tick the clients first.');
  } else {
    const r = await requestProvision(ids, admin.emp_id);
    await logActivity({ module: 'meta_leads', action: 'Queued lead ad creation', target: `${r.queued} client(s)`, details: [`Accounts: ${ids.join(', ')}`, ...r.skipped.slice(0, 10)] });
    const parts = [r.queued ? `${r.queued} lead ad(s) queued: they are created (paused) within a minute; this page shows the progress.` : 'Nothing was queued.'];
    if (r.skipped.length) parts.push(`Skipped: ${r.skipped.join('; ')}.`);
    await flash(r.queued ? 'success' : 'error', parts.join(' '));
  }
  revalidatePath(PATH);
}

/** "Create Lead Ad" for the ticked clients. */
export async function createAds(fd: FormData): Promise<void> {
  await queue([...new Set(fd.getAll('ids').map(Number).filter((n) => Number.isInteger(n) && n > 0))]);
}

/** "Create Lead Ad" / "Resume" for one client. */
export async function createAd(userId: number): Promise<void> {
  await queue([userId]);
}

/** "Activate" (confirmed in the browser): campaign, ad set and ad → ACTIVE (done by the worker within a minute). */
export async function activateAd(assetId: number): Promise<void> {
  await requireSuperAdmin();
  if (await requestActivate(assetId)) {
    const a = await one<{ ma_user_id: number; ma_campaign_name: string }>('SELECT ma_user_id, ma_campaign_name FROM js_meta_campaign_assets WHERE ma_id = $1', [assetId]);
    await logActivity({ module: 'meta_leads', action: 'Activated a lead ad (starts spending)', target: a?.ma_campaign_name || `Lead ad #${assetId}`, targetId: assetId,
      details: a ? [`Account #${a.ma_user_id}`] : [] });
    await flash('success', 'Activation queued: the campaign, ad set and ad go live within a minute. Meta then reviews the ad before it is shown.');
  } else await flash('error', 'Only a complete, paused lead ad can be activated.');
  revalidatePath(PATH);
}

export async function retryEvent(id: number): Promise<void> {
  await requireSuperAdmin();
  const n = await retryEvents(id);
  if (n) await logActivity({ module: 'meta_leads', action: 'Retried a failed lead', targetId: id });
  await flash(n ? 'success' : 'error', n ? 'The lead is tried again within a minute.' : 'This event is no longer failed.');
  revalidatePath(PATH);
}

export async function retryAllEvents(): Promise<void> {
  await requireSuperAdmin();
  const n = await retryEvents();
  if (n) await logActivity({ module: 'meta_leads', action: 'Retried all failed leads', details: [`${n} lead(s)`] });
  await flash(n ? 'success' : 'error', n ? `${n} failed lead(s) are tried again within a minute.` : 'There are no failed leads.');
  revalidatePath(PATH);
}

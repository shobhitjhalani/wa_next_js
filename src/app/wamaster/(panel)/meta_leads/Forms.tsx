'use client';

import { useEffect, useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { saveClient, saveTemplate } from './actions';
import { STANDARD_QUESTIONS, type Question, type TargetLocation } from '@/lib/meta-ad-form';
import { AreaEditor, QuestionsEditor } from './Editors';
import { CTAS, ctaLabel, SPECIAL_CATEGORIES } from './options';

export interface TemplateValues {
  campaign_name: string; form_name: string; questions: Question[]; locations: TargetLocation[]; privacy_link_text: string; thank_you_title: string; thank_you_body: string;
  thank_you_button: string; locale: string; countries: string; age_min: string; age_max: string; daily_budget: string;
  headline: string; primary_text: string; cta: string; special_ad_categories: string;
}

function Field({ name, label, hint, children, col = 'col-md-6' }: { name: string; label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; col?: string }) {
  return (
    <div className={col}>
      <label className="form-label" htmlFor={`ml-${name}`}>{label}</label>
      {children}
      {hint && <div className="form-text">{hint}</div>}
      <FieldError name={name} />
    </div>
  );
}

const specialHint = <>Comma separated, empty = none: {SPECIAL_CATEGORIES.map((c, i) => <span key={c.value}>{i > 0 && ', '}<code>{c.value}</code></span>)}</>;

export function TemplateForm({ v }: { v: TemplateValues }) {
  return (
    <ActionForm action={saveTemplate}>
      <div className="row g-3">
        <Field name="campaign_name" label="Campaign name" hint={<><code>{'{client}'}</code> = client name, <code>{'{date}'}</code> = the day it is created</>}>
          <input className="form-control" id="ml-campaign_name" name="campaign_name" defaultValue={v.campaign_name} maxLength={200} />
        </Field>
        <Field name="form_name" label="Lead form name">
          <input className="form-control" id="ml-form_name" name="form_name" defaultValue={v.form_name} maxLength={200} />
        </Field>
        <Field name="primary_text" label="Primary text" col="col-md-8">
          <textarea className="form-control" id="ml-primary_text" name="primary_text" rows={3} defaultValue={v.primary_text} maxLength={2000} />
        </Field>
        <Field name="headline" label="Headline" col="col-md-4" hint="Empty = the client’s name">
          <input className="form-control" id="ml-headline" name="headline" defaultValue={v.headline} maxLength={255} />
        </Field>
        <Field name="cta" label="Button" col="col-md-3">
          <select className="form-select" id="ml-cta" name="cta" defaultValue={v.cta}>{CTAS.map((c) => <option key={c} value={c}>{ctaLabel(c)}</option>)}</select>
        </Field>
        <Field name="daily_budget" label="Daily budget" col="col-md-3" hint="In the ad account’s currency, e.g. 500">
          <input className="form-control" id="ml-daily_budget" name="daily_budget" inputMode="decimal" defaultValue={v.daily_budget} />
        </Field>
        <Field name="countries" label="Countries" col="col-md-2" hint="e.g. IN, AE (not used when local places are set)">
          <input className="form-control" id="ml-countries" name="countries" defaultValue={v.countries} />
        </Field>
        <Field name="age_min" label="Age from" col="col-md-2">
          <input className="form-control" id="ml-age_min" name="age_min" type="number" min={13} max={65} defaultValue={v.age_min} />
        </Field>
        <Field name="age_max" label="Age to" col="col-md-2">
          <input className="form-control" id="ml-age_max" name="age_max" type="number" min={13} max={65} defaultValue={v.age_max} />
        </Field>
        <Field name="locations" label="Target area: local places (default for every client)" col="col-12">
          <AreaEditor initial={v.locations} />
        </Field>
        <Field name="special_ad_categories" label="Special ad categories" hint={specialHint}>
          <input className="form-control" id="ml-special_ad_categories" name="special_ad_categories" defaultValue={v.special_ad_categories} />
        </Field>
        <Field name="locale" label="Form language" col="col-md-2" hint="e.g. en_US">
          <input className="form-control" id="ml-locale" name="locale" defaultValue={v.locale} maxLength={5} />
        </Field>
        <Field name="privacy_link_text" label="Privacy link text" col="col-md-4">
          <input className="form-control" id="ml-privacy_link_text" name="privacy_link_text" defaultValue={v.privacy_link_text} maxLength={70} />
        </Field>
        <Field name="questions" label="Lead form questions" col="col-12"
          hint="Prefilled fields are filled in from the person’s Facebook / Instagram profile. Own questions are free text, or multiple choice when you list answers. Clients can have their own list.">
          <QuestionsEditor initial={v.questions} />
        </Field>
        <Field name="thank_you_title" label="Thank-you title" col="col-md-4">
          <input className="form-control" id="ml-thank_you_title" name="thank_you_title" defaultValue={v.thank_you_title} maxLength={60} />
        </Field>
        <Field name="thank_you_body" label="Thank-you text" col="col-md-5">
          <input className="form-control" id="ml-thank_you_body" name="thank_you_body" defaultValue={v.thank_you_body} maxLength={500} />
        </Field>
        <Field name="thank_you_button" label="Thank-you button" col="col-md-3" hint="Opens the client’s website">
          <input className="form-control" id="ml-thank_you_button" name="thank_you_button" defaultValue={v.thank_you_button} maxLength={30} />
        </Field>
      </div>
      <SubmitButton className="btn btn-primary mt-3" pendingText="Saving…"><i className="ri-save-line" /> Save template</SubmitButton>
    </ActionForm>
  );
}

export interface ClientValues {
  user_id: string; ad_account_id: string; page_id: string; privacy_policy_url: string; website_url: string; image_url: string;
  daily_budget: string; countries: string; age_min: string; age_max: string; headline: string; primary_text: string; cta: string;
  special_ad_categories: string; country_code: string; assignee: string; is_active: boolean;
  questions: Question[] | null; locations: TargetLocation[];
}

export function ClientForm({ v, clients, pages, members, template, isNew }: {
  v: ClientValues; isNew: boolean;
  clients: { id: number; name: string }[];
  pages: { id: string; name: string }[];
  members: { id: number; name: string }[];
  template: { budget: string; countries: string; ages: string; headline: string; primary: string; cta: string; area: string; questions: Question[] };
}) {
  const [ownQuestions, setOwnQuestions] = useState(v.questions !== null);
  const tpl = (x: string) => (x ? <>Empty = template: <i>{x}</i></> : 'Empty = template');
  return (
    <ActionForm action={saveClient}>
      <div className="row g-3">
        <Field name="user_id" label="Client account" hint={isNew ? 'Only accounts with Ads Management switched on (Users → Edit → Permissions)' : undefined}>
          {isNew ? (
            <select className="form-select" id="ml-user_id" name="user_id" defaultValue={v.user_id}>
              <option value="">— choose —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <><input type="hidden" name="user_id" value={v.user_id} /><div className="form-control bg-light">{clients.find((c) => String(c.id) === v.user_id)?.name ?? `#${v.user_id}`}</div></>
          )}
        </Field>
        <Field name="is_active" label="Status" col="col-md-6">
          <select className="form-select" id="ml-is_active" name="is_active" defaultValue={v.is_active ? '1' : '0'}>
            <option value="1">Active: create ads and save its leads</option>
            <option value="0">Off: its leads are ignored</option>
          </select>
        </Field>
        <Field name="ad_account_id" label="Ad account id" hint="From Business Settings → Ad accounts (act_ is added)">
          <input className="form-control" id="ml-ad_account_id" name="ad_account_id" defaultValue={v.ad_account_id} placeholder="act_1234567890" />
        </Field>
        <Field name="page_id" label="Facebook Page id" hint={pages.length ? 'Pick a connected Page or type its id' : undefined}>
          <input className="form-control" id="ml-page_id" name="page_id" list="ml-pages" defaultValue={v.page_id} placeholder="1234567890" autoComplete="off" />
          <datalist id="ml-pages">{pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</datalist>
        </Field>
        <Field name="website_url" label="Website URL" hint="The ad link and the thank-you button">
          <input className="form-control" id="ml-website_url" name="website_url" type="url" defaultValue={v.website_url} placeholder="https://" />
        </Field>
        <Field name="privacy_policy_url" label="Privacy policy URL">
          <input className="form-control" id="ml-privacy_policy_url" name="privacy_policy_url" type="url" defaultValue={v.privacy_policy_url} placeholder="https://" />
        </Field>
        <Field name="image_url" label="Creative image URL" col="col-12" hint={<>Upload it in the <a href="/wamaster/media" target="_blank" rel="noreferrer">Media Library</a> and paste its link (JPG / PNG, 1080 × 1080 or 1200 × 628).</>}>
          <ImageUrl defaultValue={v.image_url} />
        </Field>
        <Field name="primary_text" label="Primary text" col="col-md-8" hint={tpl(template.primary)}>
          <textarea className="form-control" id="ml-primary_text" name="primary_text" rows={3} defaultValue={v.primary_text} maxLength={2000} />
        </Field>
        <Field name="headline" label="Headline" col="col-md-4" hint={tpl(template.headline || 'the client’s name')}>
          <input className="form-control" id="ml-headline" name="headline" defaultValue={v.headline} maxLength={255} />
        </Field>
        <Field name="cta" label="Button" col="col-md-3">
          <select className="form-select" id="ml-cta" name="cta" defaultValue={v.cta}>
            <option value="">Template ({ctaLabel(template.cta)})</option>
            {CTAS.map((c) => <option key={c} value={c}>{ctaLabel(c)}</option>)}
          </select>
        </Field>
        <Field name="daily_budget" label="Daily budget" col="col-md-3" hint={tpl(template.budget)}>
          <input className="form-control" id="ml-daily_budget" name="daily_budget" inputMode="decimal" defaultValue={v.daily_budget} />
        </Field>
        <Field name="countries" label="Countries" col="col-md-2" hint="Empty + no places = template">
          <input className="form-control" id="ml-countries" name="countries" defaultValue={v.countries} />
        </Field>
        <Field name="age_min" label="Age from" col="col-md-2" hint={tpl(template.ages)}>
          <input className="form-control" id="ml-age_min" name="age_min" type="number" min={13} max={65} defaultValue={v.age_min} />
        </Field>
        <Field name="age_max" label="Age to" col="col-md-2">
          <input className="form-control" id="ml-age_max" name="age_max" type="number" min={13} max={65} defaultValue={v.age_max} />
        </Field>
        <Field name="locations" label="Target area: local places" col="col-12"
          hint={<>Set countries or places to give this client its own area (it then replaces the template&apos;s whole area). Empty = template: <i>{template.area}</i></>}>
          <AreaEditor initial={v.locations} />
        </Field>
        <div className="col-12">
          <div className="form-check form-switch mb-2">
            <input className="form-check-input" type="checkbox" id="ml-own_questions" name="own_questions" value="1" checked={ownQuestions} onChange={(e) => setOwnQuestions(e.target.checked)} />
            <label className="form-check-label fw-medium" htmlFor="ml-own_questions">Own lead form questions for this client</label>
          </div>
          {ownQuestions ? <QuestionsEditor initial={v.questions ?? template.questions} /> : (
            <div className="small text-muted">Template questions: {template.questions.map((q) => (q.type === 'CUSTOM' ? q.label : STANDARD_QUESTIONS.find((x) => x.type === q.type)?.label ?? q.type)).join(' · ')}</div>
          )}
          <FieldError name="questions" />
        </div>
        <Field name="special_ad_categories" label="Special ad categories" hint={<>Empty = template; <code>NONE</code> = none. {specialHint}</>}>
          <input className="form-control" id="ml-special_ad_categories" name="special_ad_categories" defaultValue={v.special_ad_categories} />
        </Field>
        <Field name="country_code" label="Phone country" col="col-md-2" hint="For numbers typed without a country code">
          <input className="form-control" id="ml-country_code" name="country_code" defaultValue={v.country_code} maxLength={2} />
        </Field>
        <Field name="assignee" label="Assign new leads to" col="col-md-4" hint={isNew ? 'Save first, then choose one of the client’s team members' : members.length ? undefined : 'This client has no team members'}>
          <select className="form-select" id="ml-assignee" name="assignee" defaultValue={v.assignee} disabled={isNew || !members.length}>
            <option value="0">Nobody (the account owner)</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
      </div>
      <SubmitButton className="btn btn-primary mt-3" pendingText="Saving…"><i className="ri-save-line" /> Save client</SubmitButton>
    </ActionForm>
  );
}

function ImageUrl({ defaultValue }: { defaultValue: string }) {
  const [url, setUrl] = useState(defaultValue);
  const [bad, setBad] = useState(false);
  return (
    <div className="d-flex gap-3 align-items-start">
      <input className="form-control" id="ml-image_url" name="image_url" type="url" value={url} onChange={(e) => { setUrl(e.target.value); setBad(false); }} placeholder="https://…/media/…jpg" />
      {/^https?:\/\//.test(url) && (
        // eslint-disable-next-line @next/next/no-img-element
        bad ? <span className="small text-danger text-nowrap">Image not found</span> : <img src={url} alt="" className="rounded border" style={{ width: 72, height: 72, objectFit: 'cover' }} onError={() => setBad(true)} />
      )}
    </div>
  );
}

/** "Create Lead Ad" for the ticked clients (row checkboxes use form="ml-bulk"). */
export function BulkCreate({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[form="ml-bulk"][name="ids"]')];
    const read = () => {
      const all = boxes();
      const n = all.filter((b) => b.checked).length;
      setCount(n);
      const head = document.querySelector<HTMLInputElement>('#ml-all');
      if (head) { head.checked = all.length > 0 && n === all.length; head.indeterminate = n > 0 && n < all.length; }
    };
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'ml-all') boxes().forEach((b) => { b.checked = t.checked; });
      if (t.id === 'ml-all' || t.getAttribute('form') === 'ml-bulk') read();
    };
    document.addEventListener('change', onChange);
    read();
    return () => document.removeEventListener('change', onChange);
  }, []);
  return (
    <form id="ml-bulk" action={action} onSubmit={(e) => {
      if (!count) { e.preventDefault(); window.alert('Tick the clients first.'); return; }
      if (!window.confirm(`Create the common lead ad for ${count} client(s)? Everything is created PAUSED; nothing is spent until you activate it.`)) e.preventDefault();
    }}>
      <SubmitButton className="btn btn-sm btn-primary" pendingText="Queuing…"><i className="ri-megaphone-line" /> Create Lead Ad{count ? ` for ${count} client(s)` : ' for selected'}</SubmitButton>
    </form>
  );
}

export function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-soft-secondary" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}>
      <i className={done ? 'ri-check-line' : 'ri-file-copy-line'} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

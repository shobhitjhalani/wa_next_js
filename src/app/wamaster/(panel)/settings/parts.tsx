import Link from 'next/link';
import { PageTitle } from '@/components/PageTitle';
import { config, url } from '@/lib/config';
import { META_KEYS, metaSettingsStatus, type MetaKey } from '@/lib/services/meta-settings';
import { MetaKeysForm, type KeyStatus } from './MetaKeysForm';

/** Sending Limits | Meta Lead Ads Keys | WhatsApp Token. */
export function SettingsTabs({ tab }: { tab: 'limits' | 'meta' | 'whatsapp' }) {
  return (
    <ul className="nav nav-tabs nav-tabs-custom mb-3">
      {TABS.map(([key, icon, label]) => (
        <li className="nav-item" key={key}>
          <Link href={key === 'limits' ? '/wamaster/settings' : `/wamaster/settings/${key}`} className={`nav-link${tab === key ? ' active' : ''}`}><i className={`${icon} me-1`} />{label}</Link>
        </li>
      ))}
    </ul>
  );
}

const TABS = [['limits', 'ri-speed-up-line', 'Sending Limits'], ['meta', 'ri-megaphone-line', 'Meta Lead Ads Keys'], ['whatsapp', 'ri-whatsapp-line', 'WhatsApp Token']] as const;

const KEY_HELP: Record<MetaKey, React.ReactNode> = {
  systemUserToken: <>Business Settings → Users → System users → your Admin system user → <b>Generate new token</b> (expiry: Never) with ads_management, ads_read, leads_retrieval, pages_manage_ads, pages_manage_metadata, pages_read_engagement, pages_show_list, business_management. When saved, Meta is asked whom it belongs to.</>,
  appSecret: <>developers.facebook.com → the Lead Ads app → App settings → Basic → <b>App secret</b> → Show. Used only to check the Lead Ads webhook (the WhatsApp webhook is not affected).</>,
  webhookVerifyToken: <>Any random text (click Generate). Type the same into the Meta App → Webhooks → Page → Verify token.</>,
};

/** The Meta Lead Ads keys: entered here (stored in the database) or taken from .env. */
export async function MetaTab({ tabs }: { tabs: React.ReactNode }) {
  const status = await metaSettingsStatus();
  const keys: KeyStatus[] = (Object.keys(META_KEYS) as MetaKey[]).map((k) => ({
    key: k, name: { systemUserToken: 'system_user_token', appSecret: 'app_secret', webhookVerifyToken: 'webhook_verify_token' }[k],
    label: META_KEYS[k].label, env: META_KEYS[k].env, source: status[k].source, hint: status[k].hint, help: KEY_HELP[k],
    updated: status[k].updated ? `Saved ${new Date(status[k].updated!.at).toLocaleString('en-IN', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' })}${status[k].updated!.by ? ` by ${status[k].updated!.by}` : ''}` : '',
  }));
  return (
    <>
      <PageTitle title="Settings" home="/wamaster/dashboard" />
      {tabs}
      <div className="row">
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Meta Lead Ads keys</h5></div>
            <div className="card-body">
              {/* remounted after a save, so the fields are empty again */}
              <MetaKeysForm key={keys.map((k) => k.hint + k.source).join('|')} keys={keys} />
            </div>
          </div>
        </div>
        <div className="col-xl-5">
          <div className="card">
            <div className="card-body small">
              <h6>How it works</h6>
              <ul className="ps-3 mb-3">
                <li>A value saved here is used instead of the one in the server&apos;s .env file; the app and the worker pick it up within 30 seconds.</li>
                <li>Saved values are never shown again in full: only their last 4 characters. Leave a field empty to keep it.</li>
                <li>Changes are recorded in the Activity Log (without the values).</li>
              </ul>
              <h6>Webhook (Meta App → Webhooks → Page → field <code>leadgen</code>)</h6>
              <div className="font-monospace text-break bg-light rounded p-2 mb-2">{url('/integrations/meta/webhook')}</div>
              <Link href="/wamaster/meta_leads" className="btn btn-sm btn-soft-primary"><i className="ri-megaphone-line" /> Meta Lead Ads: webhook health</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

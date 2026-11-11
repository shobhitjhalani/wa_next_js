'use client';

import { useState } from 'react';
import { FieldError } from '@/components/ActionForm';
import { WA_FLAG_FIELDS } from './flags';

type Flag = 'send_wa' | 'wa_enable_incoming' | 'wa_enable_catalogue' | 'send_app' | 'enable_ai' | 'google_sheet' | 'wa_coexistence';

const SWITCHES: [Flag, string][] = [
  ['send_wa', 'Send Flow'],
  ['wa_enable_catalogue', 'Catalogue'],
  ['send_app', 'Forward to App URL'],
  ['enable_ai', 'AI'],
  ['wa_enable_incoming', 'Incoming Webhook'],
  ['google_sheet', 'Google Sheet'],
  ['wa_coexistence', 'Coexistence (Mobile & Web)'],
];

const FIELD_LABELS: Record<string, [label: string, placeholder: string]> = {
  wa_form_url: ['Flow Response URL', 'https://… (flow submissions are posted here)'],
  wa_catalogue_url: ['Catalogue Order URL', 'https://… (catalogue orders are posted here)'],
  wa_app_url: ['App URL (raw webhook forward)', 'https://… (every webhook is forwarded here)'],
  ai_key: ['AI API Key', ''],
};

/**
 * WhatsApp user options: each switch that needs a value (Send Flow → Flow
 * Response URL, Catalogue → Catalogue Order URL, Forward to App URL → App URL,
 * AI → AI API Key) shows its field only while switched on; the action clears
 * the value when the switch is off. MM Lite is always on (no switch).
 */
export function WaOptions({ flags, values }: { flags: Partial<Record<Flag, boolean>>; values: Record<string, string> }) {
  const [on, setOn] = useState(flags);
  return (
    <div className="row g-3">
      {SWITCHES.map(([flag, label]) => {
        const field = WA_FLAG_FIELDS[flag as keyof typeof WA_FLAG_FIELDS];
        const checked = !!on[flag];
        return (
          <div className={field ? 'col-md-6' : 'col-md-3'} key={flag}>
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" role="switch" id={`flag_${flag}`} name={flag} value="1"
                checked={checked} onChange={(e) => setOn((o) => ({ ...o, [flag]: e.target.checked }))} />
              <label className="form-check-label" htmlFor={`flag_${flag}`}>{label}</label>
            </div>
            {field && checked && (
              <div className="mt-2">
                <label className="form-label small mb-1" htmlFor={field}>{FIELD_LABELS[field][0]}</label>
                <input
                  type={field === 'ai_key' ? 'text' : 'url'} className="form-control" id={field} name={field}
                  defaultValue={values[field] ?? ''} placeholder={FIELD_LABELS[field][1]} autoComplete="off"
                />
                <FieldError name={field} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

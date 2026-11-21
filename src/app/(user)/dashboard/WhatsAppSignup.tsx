'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

type State = { kind: 'idle' | 'open' | 'saving' | 'error' | 'cancel'; text?: string };

/**
 * WhatsApp Embedded Signup ("Login with Facebook"): loads the Facebook SDK, opens Meta's signup popup and, when it
 * finishes, stores the phone number / WABA / business ids via POST /user_update (which registers the number and
 * subscribes the app), then reloads the dashboard. `coexistence` onboards an existing WhatsApp Business App number.
 */
export function WhatsAppSignup({ appId, configId, coexistence }: { appId: string; configId: string; coexistence: boolean }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: 'v27.0' });
      setReady(true);
    };
    // The SDK may already be loaded (client-side navigation back to the dashboard)
    if (window.FB) window.fbAsyncInit();

    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/([a-z]+\.)?facebook\.com$/.test(event.origin)) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const ev = String(data.event ?? '');
      if (ev.startsWith('FINISH')) {
        // FINISH (new number) or FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (coexistence)
        setState({ kind: 'saving' });
        const body = new URLSearchParams();
        body.set('phone_number_id', data.data?.phone_number_id ?? '');
        body.set('waba_id', data.data?.waba_id ?? '');
        body.set('business_id', data.data?.business_id ?? '');
        fetch('/user_update', { method: 'POST', body, credentials: 'same-origin' })
          .then(async (res) => {
            if (res.ok) { window.location.reload(); return; }
            const j = await res.json().catch(() => ({}));
            setState({ kind: 'error', text: j.message ?? 'Your WhatsApp account could not be saved. Please try again.' });
          })
          .catch(() => setState({ kind: 'error', text: 'Your WhatsApp account could not be saved. Please try again.' }));
      } else if (ev === 'CANCEL') {
        const step = data.data?.current_step;
        setState({ kind: 'cancel', text: `Signup was closed before it finished${step ? ` (at “${step.replace(/_/g, ' ').toLowerCase()}”)` : ''}. Click the button to start again.` });
      } else if (ev === 'ERROR') {
        setState({ kind: 'error', text: `Facebook reported an error: ${data.data?.error_message ?? 'unknown error'}.` });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appId]);

  const launch = () => {
    if (!window.FB) return;
    setState({ kind: 'open' });
    window.FB.login((response: { authResponse?: unknown }) => {
      // Closing the popup without finishing: no FINISH message arrives
      if (!response?.authResponse) setState((s) => (s.kind === 'open' ? { kind: 'cancel', text: 'Signup was closed before it finished. Click the button to start again.' } : s));
    }, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: coexistence ? 'whatsapp_business_app_onboarding' : '', sessionInfoVersion: '3' },
    });
  };

  return (
    <>
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" crossOrigin="anonymous" />
      <button type="button" className="btn btn-primary btn-sm" onClick={launch} disabled={!ready || state.kind === 'saving'}>
        {state.kind === 'saving'
          ? <><span className="spinner-border spinner-border-sm me-1" />Saving…</>
          : <><i className="ri-facebook-fill" /> {ready ? 'Login with Facebook' : 'Loading Facebook…'}</>}
      </button>
      {state.text && <div className={`small mt-2 ${state.kind === 'error' ? 'text-danger' : 'text-muted'}`}>{state.text}</div>}
    </>
  );
}

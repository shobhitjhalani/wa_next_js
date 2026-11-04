'use client';

import Script from 'next/script';
import { useEffect } from 'react';

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

/**
 * WhatsApp Embedded Signup (dashboard.blade.php's Facebook SDK script): loads
 * the SDK, opens the signup popup, and on FINISH stores the phone number /
 * WABA / business ids via POST /user_update, then reloads the page.
 */
export function WhatsAppSignup({ appId, configId }: { appId: string; configId: string }) {
  useEffect(() => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: 'v25.0' });
    };
    // The SDK may already be loaded (client-side navigation back to the dashboard)
    if (window.FB) window.fbAsyncInit();

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
          const body = new URLSearchParams();
          body.set('phone_number_id', data.data?.phone_number_id ?? '');
          body.set('waba_id', data.data?.waba_id ?? '');
          body.set('business_id', data.data?.business_id ?? '');
          fetch('/user_update', { method: 'POST', body, credentials: 'same-origin' }).then((res) => {
            if (res.ok) window.location.reload();
          });
        }
      } catch {
        /* not a signup message */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [appId]);

  const launch = () => {
    window.FB?.login(() => {}, {
      config_id: configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    });
  };

  return (
    <>
      <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" crossOrigin="anonymous" />
      <button type="button" className="btn btn-primary btn-sm" onClick={launch}><i className="ri-facebook-fill" /> Login with Facebook</button>
    </>
  );
}

'use client';

import { useEffect, useRef } from 'react';

/** Posts the encrypted request to CCAvenue as soon as the page is shown (legacy document.redirect.submit()). */
export function AutoSubmit({ action, encRequest, accessCode }: { action: string; encRequest: string; accessCode: string }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.submit(); }, []);
  return (
    <form ref={ref} method="post" name="redirect" action={action}>
      <input type="hidden" name="encRequest" value={encRequest} />
      <input type="hidden" name="access_code" value={accessCode} />
      <noscript><button type="submit">Continue to payment</button></noscript>
    </form>
  );
}

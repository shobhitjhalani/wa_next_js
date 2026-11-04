'use client';

import { useEffect } from 'react';

/** Reload a running / scheduled campaign every 30 seconds while the tab is visible. */
export function AutoReload({ seconds = 30 }: { seconds?: number }) {
  useEffect(() => {
    const t = setTimeout(() => { if (!document.hidden) location.reload(); }, seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return null;
}

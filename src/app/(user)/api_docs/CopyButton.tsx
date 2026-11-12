'use client';

import { useState } from 'react';

/** Small "Copy" button for the API key and code samples. */
export function CopyButton({ text, className = 'btn btn-sm btn-soft-secondary' }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button" className={className}
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}
    >
      <i className={done ? 'ri-check-line' : 'ri-file-copy-line'} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

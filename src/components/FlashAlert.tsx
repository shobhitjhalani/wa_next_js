'use client';

import { useEffect, useState } from 'react';

export interface Flash {
  id: string;
  type: 'success' | 'error';
  message: string;
}

/** One-time alert set by flash() in a Server Action; clears its cookie once shown. */
export function FlashAlert({ flash }: { flash: Flash }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    document.cookie = 'wa_flash=; Max-Age=0; path=/';
    setOpen(true);
  }, [flash.id]);
  if (!open) return null;
  return (
    <div className={`alert alert-${flash.type === 'success' ? 'success' : 'danger'} alert-dismissible fade show`} role="alert" style={{ whiteSpace: 'pre-line' }}>
      {flash.message}
      <button type="button" className="btn-close" aria-label="Close" onClick={() => setOpen(false)} />
    </div>
  );
}

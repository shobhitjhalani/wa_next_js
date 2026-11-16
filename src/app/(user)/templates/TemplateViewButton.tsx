'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * "View" button on the template list: opens a popup with the template as WhatsApp shows it
 * (header image / video, formatted text, footer, buttons, carousel cards). The preview itself
 * is rendered on the server and passed in as children; it is only mounted while open, so
 * header images load on demand.
 */
export function TemplateViewButton({ id, name, category, language, sendHref, children }: {
  id: number;
  name: string;
  category: string | null;
  language: string | null;
  /** Compose link, or null when the account may not send this category. */
  sendHref: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open]);

  const titleId = `tpl_view_title_${id}`;
  return (
    <>
      <button type="button" className="btn btn-sm btn-soft-info" title="View template" aria-label={`View template ${name}`} onClick={() => setOpen(true)}>
        <i className="ri-eye-line" />
      </button>
      {open && (
        <>
          <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
            <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-fullscreen-sm-down">
              <div className="modal-content">
                <div className="modal-header">
                  <div className="text-truncate">
                    <h5 className="modal-title text-truncate" id={titleId}>{name}</h5>
                    <div className="small text-muted">{[category, language].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setOpen(false)} autoFocus />
                </div>
                <div className="modal-body tpl-view-body">{children}</div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-light" onClick={() => setOpen(false)}>Close</button>
                  {sendHref && <Link className="btn btn-success" href={sendHref}><i className="ri-send-plane-2-line" /> Send Template</Link>}
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      )}
    </>
  );
}

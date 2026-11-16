'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Emoji picker button for message text areas (like WhatsApp Manager's): categories, search,
 * frequently used and skin tones, via emoji-mart. The picker and its emoji data (~430 KB)
 * are loaded the first time it is opened. A chosen emoji replaces the textarea selection,
 * or is inserted at the cursor; the picker stays open to add more (Esc / click outside closes).
 */
export function EmojiButton({ target, onInsert }: {
  target: () => HTMLTextAreaElement | null | undefined;
  /** Receives the textarea's full new value. */
  onInsert: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // The picker is created once per opening; keep the latest callbacks for its handlers
  const latest = useRef({ target, onInsert });
  useEffect(() => { latest.current = { target, onInsert }; });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const host = hostRef.current;

    Promise.all([import('emoji-mart'), import('@emoji-mart/data')])
      .then(([{ Picker }, data]) => {
        if (cancelled || !host) return;
        const picker = new Picker({
          data: data.default ?? data,
          theme: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light',
          previewPosition: 'none',
          skinTonePosition: 'search',
          perLine: 8,
          maxFrequentRows: 2,
          autoFocus: true,
          onEmojiSelect: (emoji: { native?: string }) => insert(emoji.native ?? ''),
          onClickOutside: (e: MouseEvent) => {
            // The toggle button is "outside" the picker too; let its own click handle that
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
          },
        });
        host.replaceChildren(picker as unknown as Node);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
      host?.replaceChildren();
    };
  }, [open]);

  function insert(emoji: string) {
    if (!emoji) return;
    const el = latest.current.target();
    const current = el?.value ?? '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? start;
    latest.current.onInsert(current.slice(0, start) + emoji + current.slice(end));
    const caret = start + emoji.length;
    requestAnimationFrame(() => { el?.setSelectionRange(caret, caret); });
  }

  return (
    <div className="position-relative d-inline-block" ref={wrapRef}>
      <button
        type="button" className={`btn btn-light border btn-sm${open ? ' active' : ''}`} title="Emoji" aria-label="Insert emoji" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault() /* keep the textarea selection */}
        onClick={() => { setFailed(false); setOpen((o) => !o); }}
      >
        <i className="ri-emotion-happy-line" />
      </button>
      {open && (
        <div className="emoji-popover" role="dialog" aria-label="Emoji picker">
          {failed ? <div className="p-3 small text-danger bg-body border rounded">Could not load emojis.</div> : <div ref={hostRef} />}
        </div>
      )}
    </div>
  );
}

'use client';

import './crm.css';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Due { id: number; name: string; mobile: string; at: number }

const SEEN_KEY = 'crm-reminders-seen';

function readSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function writeSeen(seen: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300))); } catch { /* private window */ }
}
const keyOf = (d: Due) => `${d.id}:${d.at}`;
const timeOf = (at: number) => new Date(at * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/**
 * Follow-up reminder pop-up for the whole panel: checks every minute for lead follow-ups that are
 * due, shows the ones not dismissed yet, and a desktop notification when the browser allows it.
 */
export function CrmReminders() {
  const [items, setItems] = useState<Due[]>([]);
  const [canNotify, setCanNotify] = useState(false);
  const notified = useRef(new Set<string>());

  const check = useCallback(async () => {
    try {
      const res = await fetch('/crm/reminders', { cache: 'no-store' });
      if (!res.ok) return;
      const due: Due[] = (await res.json()).due ?? [];
      const seen = readSeen();
      const fresh = due.filter((d) => !seen.has(keyOf(d)));
      setItems(fresh);
      const toNotify = fresh.filter((d) => !notified.current.has(keyOf(d)));
      if (toNotify.length && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const first = toNotify[0];
        const n = new Notification(toNotify.length === 1 ? 'Follow-up due' : `${toNotify.length} follow-ups due`, {
          body: toNotify.slice(0, 3).map((d) => d.name || d.mobile).join(', '), tag: 'crm-followup',
        });
        n.onclick = () => { window.focus(); window.location.href = toNotify.length === 1 ? `/crm/${first.id}` : '/crm?tab=due'; };
      }
      toNotify.forEach((d) => notified.current.add(keyOf(d)));
    } catch { /* offline: try again next minute */ }
  }, []);

  useEffect(() => {
    setCanNotify(typeof Notification !== 'undefined' && Notification.permission === 'default');
    const first = setTimeout(check, 1500);
    const timer = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [check]);

  const dismiss = (list: Due[]) => {
    const seen = readSeen();
    list.forEach((d) => seen.add(keyOf(d)));
    writeSeen(seen);
    setItems((cur) => cur.filter((d) => !list.some((x) => keyOf(x) === keyOf(d))));
  };

  if (!items.length) return null;
  return (
    <div className="crm-toast card shadow-lg border border-warning mb-0" role="alert" aria-live="polite">
      <div className="card-header d-flex align-items-center bg-warning-subtle py-2">
        <i className="ri-alarm-warning-line text-warning fs-5 me-2" />
        <span className="fw-semibold me-auto">{items.length === 1 ? 'Follow-up due' : `${items.length} follow-ups due`}</span>
        <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => dismiss(items)} />
      </div>
      <ul className="list-group list-group-flush">
        {items.slice(0, 4).map((d) => (
          <li key={keyOf(d)} className="list-group-item d-flex align-items-center gap-2 py-2">
            <div className="flex-grow-1 min-w-0">
              <Link href={`/crm/${d.id}#followup`} className="fw-medium text-body d-block text-truncate" onClick={() => dismiss([d])}>{d.name || d.mobile || `Lead #${d.id}`}</Link>
              <span className="small text-muted">{d.mobile && d.name ? `${d.mobile} · ` : ''}{timeOf(d.at)}</span>
            </div>
            <button type="button" className="btn btn-sm btn-light" title="Dismiss" aria-label="Dismiss" onClick={() => dismiss([d])}><i className="ri-check-line" /></button>
          </li>
        ))}
      </ul>
      <div className="card-footer d-flex align-items-center gap-2 py-2">
        <Link href="/crm?tab=due" className="btn btn-sm btn-warning" onClick={() => dismiss(items)}>Open follow-ups</Link>
        {canNotify && (
          <button type="button" className="btn btn-sm btn-link ms-auto px-0"
            onClick={() => Notification.requestPermission().then(() => setCanNotify(false)).catch(() => setCanNotify(false))}>
            <i className="ri-notification-3-line" /> Desktop alerts
          </button>
        )}
      </div>
    </div>
  );
}

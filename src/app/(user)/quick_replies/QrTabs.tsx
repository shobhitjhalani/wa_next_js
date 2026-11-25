import Link from 'next/link';

/** Quick Replies | Sent Log */
export function QrTabs({ tab }: { tab: 'replies' | 'log' }) {
  return (
    <ul className="nav nav-tabs nav-tabs-custom mb-3">
      <li className="nav-item">
        <Link href="/quick_replies" className={`nav-link${tab === 'replies' ? ' active' : ''}`} aria-current={tab === 'replies' ? 'page' : undefined}>
          <i className="ri-reply-all-line me-1" />Quick Replies
        </Link>
      </li>
      <li className="nav-item">
        <Link href="/quick_replies/log" className={`nav-link${tab === 'log' ? ' active' : ''}`} aria-current={tab === 'log' ? 'page' : undefined}>
          <i className="ri-history-line me-1" />Sent Log
        </Link>
      </li>
    </ul>
  );
}

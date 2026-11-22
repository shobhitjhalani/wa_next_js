import Link from 'next/link';

/** Meta Lead Ads sections. */
export function MetaLeadsTabs({ tab }: { tab: 'ads' | 'leads' | 'pages' }) {
  const items = [
    { key: 'leads', label: 'Facebook Leads', icon: 'ri-contacts-book-2-line', href: '/wamaster/meta_leads/leads' },
    { key: 'pages', label: 'Lead Pages', icon: 'ri-pages-line', href: '/wamaster/meta_leads/pages' },
    { key: 'ads', label: 'Lead Ads', icon: 'ri-megaphone-line', href: '/wamaster/meta_leads' },
  ];
  return (
    <ul className="nav nav-tabs nav-tabs-custom mb-3">
      {items.map((i) => (
        <li key={i.key} className="nav-item">
          <Link href={i.href} className={`nav-link${tab === i.key ? ' active' : ''}`}><i className={`${i.icon} me-1`} />{i.label}</Link>
        </li>
      ))}
    </ul>
  );
}

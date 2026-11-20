'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export interface MenuLink {
  label: string;
  href: string;
  /** Extra path prefixes that mark this link active (default: href itself) */
  match?: string[];
  /** Active only on exactly this path (not on the paths below it) */
  exact?: boolean;
}

export interface MenuItem extends Partial<MenuLink> {
  label: string;
  icon: string;
  children?: MenuLink[];
}

function isActive(pathname: string, link: Partial<MenuLink>): boolean {
  if (link.exact && link.href) return pathname === link.href.split('?')[0];
  const prefixes = link.match ?? (link.href ? [link.href.split('?')[0]] : []);
  return prefixes.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')));
}

/** Vertical sidebar menu; active entries follow client-side navigation. */
export function Sidebar({ items, logoutUrl }: { items: MenuItem[]; logoutUrl?: string }) {
  const pathname = usePathname();

  // Mobile: close the off-canvas menu after navigating
  useEffect(() => {
    document.body.classList.remove('vertical-sidebar-enable');
  }, [pathname]);

  return (
    <ul className="navbar-nav" id="navbar-nav">
      <li className="menu-title"><span>Menu</span></li>
      {items.map((item, i) => {
        if (!item.children) {
          return (
            <li className="nav-item" key={i}>
              <Link className={`nav-link menu-link${isActive(pathname, item) ? ' active' : ''}`} href={item.href ?? '#'}>
                <i className={item.icon} /> <span>{item.label}</span>
              </Link>
            </li>
          );
        }
        const open = item.children.some((c) => isActive(pathname, c)) || (item.match ? isActive(pathname, item) : false);
        const id = `menu${i}`;
        return (
          <li className="nav-item" key={i}>
            <a className={`nav-link menu-link${open ? '' : ' collapsed'}`} href={`#${id}`} data-bs-toggle="collapse" role="button" aria-expanded={open}>
              <i className={item.icon} /> <span>{item.label}</span>
            </a>
            <div className={`collapse menu-dropdown${open ? ' show' : ''}`} id={id}>
              <ul className="nav nav-sm flex-column">
                {item.children.map((c, j) => (
                  <li className="nav-item" key={j}>
                    <Link href={c.href} className={`nav-link${isActive(pathname, c) ? ' active' : ''}`}>{c.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
      {logoutUrl && (
        <li className="nav-item mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
          <form method="post" action={logoutUrl}>
            <button type="submit" className="nav-link menu-link w-100 text-start border-0 bg-transparent">
              <i className="ri-logout-box-r-line" /> <span>Logout</span>
            </button>
          </form>
        </li>
      )}
    </ul>
  );
}

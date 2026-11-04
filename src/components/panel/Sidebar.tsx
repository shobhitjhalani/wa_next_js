'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export interface MenuLink {
  label: string;
  href: string;
  /** Extra path prefixes that mark this link active (default: href itself) */
  match?: string[];
}

export interface MenuItem extends Partial<MenuLink> {
  label: string;
  icon: string;
  children?: MenuLink[];
}

function isActive(pathname: string, link: Partial<MenuLink>): boolean {
  const prefixes = link.match ?? (link.href ? [link.href.split('?')[0]] : []);
  return prefixes.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')));
}

/** Vertical sidebar menu; active entries follow client-side navigation. */
export function Sidebar({ items }: { items: MenuItem[] }) {
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
    </ul>
  );
}

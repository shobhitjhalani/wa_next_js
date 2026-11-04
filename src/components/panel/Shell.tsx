import Link from 'next/link';
import { config } from '@/lib/config';
import { FullscreenButton, HamburgerButton, SidebarOverlay } from './PanelChrome';
import { Sidebar, type MenuItem } from './Sidebar';

/**
 * Panel frame shared by the user and admin panels (the Blade base layout):
 * topbar with the account dropdown, dark vertical sidebar, content, footer.
 */
export function Shell({ home, profileUrl, logoutUrl, userName, userSub, menu, children }: {
  home: string;
  profileUrl: string;
  logoutUrl: string;
  userName: string;
  userSub: string;
  menu: MenuItem[];
  children: React.ReactNode;
}) {
  return (
    <div id="layout-wrapper">
      <header id="page-topbar">
        <div className="layout-width">
          <div className="navbar-header">
            <div className="d-flex">
              <div className="navbar-brand-box horizontal-logo">
                <Link href={home} className="logo logo-dark">
                  <span className="logo-sm"><img src="/assets/images/logo-sm.png" alt="" height={40} /></span>
                  <span className="logo-lg"><img src="/assets/images/logo-dark.png" alt="" height={40} /></span>
                </Link>
              </div>
              <HamburgerButton />
            </div>
            <div className="d-flex align-items-center">
              <div className="ms-1 header-item d-none d-sm-flex">
                <FullscreenButton />
              </div>
              <div className="dropdown ms-sm-3 header-item topbar-user">
                <button type="button" className="btn" id="page-header-user-dropdown" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                  <span className="d-flex align-items-center">
                    <img className="rounded-circle header-profile-user" src="/assets/images/user-no-img.jpg" alt="" />
                    <span className="text-start ms-xl-2">
                      <span className="d-none d-xl-inline-block ms-1 fw-medium user-name-text">{userName}</span>
                      <span className="d-none d-xl-block ms-1 fs-12 user-name-sub-text">{userSub}</span>
                    </span>
                  </span>
                </button>
                <div className="dropdown-menu dropdown-menu-end">
                  <h6 className="dropdown-header">Welcome {userName}!</h6>
                  <Link className="dropdown-item" href={profileUrl}>
                    <i className="mdi mdi-account-circle text-muted fs-16 align-middle me-1" /> Profile
                  </Link>
                  <div className="dropdown-divider" />
                  <form method="post" action={logoutUrl}>
                    <button className="dropdown-item" type="submit">
                      <i className="mdi mdi-logout text-muted fs-16 align-middle me-1" /> Logout
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="app-menu navbar-menu">
        <div className="navbar-brand-box">
          <Link href={home} className="logo logo-light">
            <span className="logo-sm"><img src="/assets/images/logo-sm.png" alt="" height={40} /></span>
            <span className="logo-lg"><img src="/assets/images/logo-light.png" alt="" height={40} /></span>
          </Link>
          <Link href={home} className="logo logo-dark">
            <span className="logo-sm"><img src="/assets/images/logo-sm.png" alt="" height={40} /></span>
            <span className="logo-lg"><img src="/assets/images/logo-dark.png" alt="" height={40} /></span>
          </Link>
        </div>
        <div id="scrollbar" style={{ overflowY: 'auto', height: 'calc(100% - 70px)' }}>
          <div className="container-fluid">
            <div id="two-column-menu" />
            <Sidebar items={menu} />
          </div>
        </div>
        <div className="sidebar-background" />
      </div>
      <SidebarOverlay />

      <div className="main-content">
        <div className="page-content">
          <div className="container-fluid">{children}</div>
        </div>
        <footer className="footer">
          <div className="container-fluid">
            <div className="row">
              <div className="col-sm-6">{new Date().getFullYear()} © {config.appName}.</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

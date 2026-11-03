import Script from "next/script";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import type { Admin } from "@/lib/admin/guard";
import { masterHeadings } from "@/lib/admin/masters";

const A = config.assetsUrl;

export type MenuGroup = "masters" | "user" | "reports" | "teams" | "";

function Logo() {
  return (
    <>
      <a href="/wamaster/dashboard" className="logo logo-dark">
        <span className="logo-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${A}images/logo-sm.png`} alt="" height="50" />
        </span>
        <span className="logo-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${A}images/logo-dark.png`} alt="" height="45" />
        </span>
      </a>
      <a href="/wamaster/dashboard" className="logo logo-light">
        <span className="logo-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${A}images/logo-sm.png`} alt="" height="50" />
        </span>
        <span className="logo-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${A}images/logo-light.png`} alt="" height="45" />
        </span>
      </a>
    </>
  );
}

function Dropdown({ id, icon, title, open, children }: { id: string; icon: string; title: string; open: boolean; children: React.ReactNode }) {
  return (
    <li className="nav-item">
      <a className={`nav-link menu-link ${open ? "collapsed active" : ""}`} href={`#${id}`} data-bs-toggle="collapse" role="button" aria-expanded={open} aria-controls={id}>
        <i className={icon}></i> <span>{title}</span>
      </a>
      <div className={`menu-dropdown collapse ${open ? "show" : ""}`} id={id}>
        <ul className="nav nav-sm flex-column">{children}</ul>
      </div>
    </li>
  );
}

const Item = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <li className="nav-item">
    <a className="nav-link" href={href}>
      {children}
    </a>
  </li>
);

/** wamaster/view/includes/header.php + menubar.php + footer.php */
export default async function AdminShell({ admin, group, children }: { admin: Admin; group: MenuGroup; children: React.ReactNode }) {
  const [headings, userTypes] = await Promise.all([
    admin.isSuper ? masterHeadings() : Promise.resolve([]),
    db.js_master_value.findMany({
      where: { mv_status: 1, mv_dstatus: 0, mv_type: 94 },
      orderBy: { mv_name: "asc" },
      select: { mv_id: true, mv_name: true },
    }),
  ]);

  return (
    <>
      {/* The admin uses the vertical layout; the user panel uses horizontal. Set before paint. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(h){h.setAttribute("data-layout","vertical");h.setAttribute("data-sidebar","dark");h.setAttribute("data-sidebar-size","sm-hover");h.setAttribute("data-layout-style","default");})(document.documentElement);`,
        }}
      />
      <link href={`${A}css/custom.css`} rel="stylesheet" />
      <div id="layout-wrapper">
        <header id="page-topbar">
          <div className="layout-width">
            <div className="navbar-header">
              <div className="d-flex">
                <div className="navbar-brand-box horizontal-logo">
                  <Logo />
                </div>
                <button type="button" className="btn btn-sm px-3 fs-16 header-item vertical-menu-btn topnav-hamburger" id="topnav-hamburger-icon">
                  <span className="hamburger-icon">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </button>
              </div>
              <div className="d-flex align-items-center">
                <div className="ms-1 header-item d-none d-sm-flex">
                  <button type="button" className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle" data-toggle="fullscreen">
                    <i className="bx bx-fullscreen fs-22"></i>
                  </button>
                </div>
                <div className="dropdown ms-sm-3 header-item topbar-user">
                  <button type="button" className="btn" id="page-header-user-dropdown" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                    <span className="d-flex align-items-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="rounded-circle header-profile-user" src={`${A}images/user-no-img.jpg`} alt="" />
                      <span className="text-start ms-xl-2">
                        <span className="d-none d-xl-inline-block ms-1 fw-medium user-name-text">Welcome {admin.name}</span>
                      </span>
                    </span>
                  </button>
                  <div className="dropdown-menu dropdown-menu-end">
                    <h6 className="dropdown-header">Welcome {admin.name}!</h6>
                    <a className="dropdown-item" href="/wamaster/profile">
                      <i className="mdi mdi-account-circle text-muted fs-16 align-middle me-1"></i> <span className="align-middle">Profile</span>
                    </a>
                    <a className="dropdown-item" href="/wamaster/change_password">
                      <i className="mdi mdi-account-circle text-muted fs-16 align-middle me-1"></i> <span className="align-middle">Change Password</span>
                    </a>
                    <div className="dropdown-divider"></div>
                    <a className="dropdown-item" href="/wamaster/logout">
                      <i className="mdi mdi-logout text-muted fs-16 align-middle me-1"></i> <span className="align-middle">Logout</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="app-menu navbar-menu">
          <div className="navbar-brand-box">
            <Logo />
            <button type="button" className="btn btn-sm p-0 fs-20 header-item float-end btn-vertical-sm-hover" id="vertical-hover">
              <i className="ri-record-circle-line"></i>
            </button>
          </div>
          <div id="scrollbar">
            <div className="container-fluid">
              <div id="two-column-menu"></div>
              <ul className="navbar-nav" id="navbar-nav">
                <li className="menu-title">
                  <span>Menu</span>
                </li>
                <li className="nav-item">
                  <a className="nav-link menu-link" href="/wamaster/dashboard">
                    <i className="ri-home-4-line"></i> <span>Dashboards</span>
                  </a>
                </li>
                {admin.isSuper && (
                  <>
                    <Dropdown id="sidebarDataMaster" icon="ri-file-list-3-line" title="Data Masters" open={group === "masters"}>
                      {headings.map((h) => (
                        <Item key={h.id} href={`/wamaster/view/masters?h=${h.id}`}>
                          {h.name}
                        </Item>
                      ))}
                    </Dropdown>
                    <li className="nav-item">
                      <a className={`nav-link menu-link ${group === "teams" ? "active" : ""}`} href="/wamaster/view/teams">
                        <i className="ri-user-2-line"></i> <span>Team Members</span>
                      </a>
                    </li>
                  </>
                )}
                <Dropdown id="sidebarUser" icon="ri-user-3-line" title="Users" open={group === "user"}>
                  {userTypes.map((t) => (
                    <Item key={String(t.mv_id)} href={`/wamaster/view/user?ut=${t.mv_id}`}>
                      {t.mv_name}
                    </Item>
                  ))}
                </Dropdown>
                <Dropdown id="sidebarReport" icon="ri-file-chart-line" title="Reports" open={group === "reports"}>
                  <Item href="/wamaster/view/reports/wa_send">WA Send</Item>
                  <Item href="/wamaster/view/reports/wa_que">WA In Que</Item>
                  <Item href="/wamaster/view/reports/templates">Templates Summary</Item>
                  {admin.isSuper && (
                    <>
                      <Item href="/wamaster/view/reports/recharges">WA Recharges</Item>
                      <Item href="/wamaster/view/reports/summary">WA Summary</Item>
                      <Item href="/wamaster/view/reports/wa_error">WA Error</Item>
                      <Item href="/wamaster/view/reports/wa_failed">WA Failed</Item>
                      <Item href="/wamaster/view/reports/wa_in_process">WA In Process</Item>
                      <Item href="/wamaster/view/reports/google_sheets">Active Google Sheets</Item>
                    </>
                  )}
                </Dropdown>
                <li className="nav-item">
                  <a className="nav-link menu-link" href="/wamaster/logout">
                    <i className="ri-logout-box-r-line"></i> <span>Logout</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="sidebar-background"></div>
        </div>

        <div className="vertical-overlay"></div>
        <div className="main-content">
          <div className="page-content">
            <div className="container-fluid">{children}</div>
          </div>
          <footer className="footer">
            <div className="container-fluid">
              <div className="row">
                <div className="col-sm-6">
                  {new Date().getFullYear()} © {config.siteName}.
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>

      <Script src={`${A}js/jquery.min.js`} strategy="afterInteractive" />
      <Script src={`${A}libs/simplebar/simplebar.min.js`} strategy="afterInteractive" />
      <Script src={`${A}libs/node-waves/waves.min.js`} strategy="afterInteractive" />
      <Script src={`${A}libs/feather-icons/feather.min.js`} strategy="afterInteractive" />
      <Script src={`${A}js/plugins.js`} strategy="afterInteractive" />
      <Script src={`${A}js/app.js`} strategy="lazyOnload" />
    </>
  );
}

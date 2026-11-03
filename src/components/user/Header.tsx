/* eslint-disable @next/next/no-img-element */
import { config } from "@/lib/config";

const A = config.assetsUrl;

// includes/header.php (top bar). Plain <a> links: every page is a full load, like the
// PHP app, so the theme scripts initialise menus and pickers on each page.
export default function Header({ name }: { name: string }) {
  return (
    <header id="page-topbar">
      <div className="layout-width">
        <div className="navbar-header">
          <div className="d-flex">
            <div className="navbar-brand-box horizontal-logo">
              <a href="/dashboard" className="logo logo-dark">
                <span className="logo-sm">
                  <img src={`${A}images/logo-sm.png`} alt="" height="50" />
                </span>
                <span className="logo-lg">
                  <img src={`${A}images/logo-dark.png`} alt="" height="45" />
                </span>
              </a>
              <a href="/dashboard" className="logo logo-light">
                <span className="logo-sm">
                  <img src={`${A}images/logo-sm.png`} alt="" height="50" />
                </span>
                <span className="logo-lg">
                  <img src={`${A}images/logo-light.png`} alt="" height="45" />
                </span>
              </a>
            </div>
            <button
              type="button"
              className="btn btn-sm px-3 fs-16 header-item vertical-menu-btn topnav-hamburger"
              id="topnav-hamburger-icon"
            >
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
              <button
                type="button"
                className="btn"
                id="page-header-user-dropdown"
                data-bs-toggle="dropdown"
                aria-haspopup="true"
                aria-expanded="false"
              >
                <span className="d-flex align-items-center">
                  <img className="rounded-circle header-profile-user" src={`${A}images/user-no-img.jpg`} alt="" />
                  <span className="text-start ms-xl-2">
                    <span className="d-none d-xl-inline-block ms-1 fw-medium user-name-text">Welcome {name}</span>
                    <span className="d-none d-xl-block ms-1 fs-12 user-name-sub-text"></span>
                  </span>
                </span>
              </button>
              <div className="dropdown-menu dropdown-menu-end">
                <h6 className="dropdown-header">Welcome {name}!</h6>
                <div className="dropdown-divider"></div>
                <a className="dropdown-item" href="/logout">
                  <i className="mdi mdi-logout text-muted fs-16 align-middle me-1"></i>{" "}
                  <span className="align-middle" data-key="t-logout">Logout</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

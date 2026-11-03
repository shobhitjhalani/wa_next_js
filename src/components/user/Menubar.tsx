/* eslint-disable @next/next/no-img-element */
import { config } from "@/lib/config";

const A = config.assetsUrl;

// includes/header.php (app-menu) + includes/menubar.php, with the same per-user rules.
export default function Menubar({ userId, enableAi }: { userId: number; enableAi: boolean }) {
  const hideSend = userId === 35;
  const hideReports = userId === 11 || userId === 35;
  return (
    <div className="app-menu navbar-menu">
      <div className="navbar-brand-box">
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
            <img src={`${A}images/logo-light.png`} alt="" height="17" />
          </span>
        </a>
        <button type="button" className="btn btn-sm p-0 fs-20 header-item float-end btn-vertical-sm-hover" id="vertical-hover">
          <i className="ri-record-circle-line"></i>
        </button>
      </div>

      <div id="scrollbar">
        <div className="container-fluid">
          <div id="two-column-menu"></div>
          <ul className="navbar-nav" id="navbar-nav">
            <li className="menu-title">
              <span data-key="t-menu">Menu</span>
            </li>
            <li className="nav-item">
              <a className="nav-link menu-link" href="/dashboard">
                <i className="ri-home-4-line"></i> <span>Dashboards</span>
              </a>
            </li>
            {!hideSend && (
              <>
                <li className="nav-item">
                  <a className="nav-link menu-link" href="/templates?s=false">
                    <i className="ri-file-edit-line"></i> <span>WA Templates</span>
                  </a>
                </li>
                <li className="nav-item">
                  <a className="nav-link menu-link" href="/compose?s=false">
                    <i className=" ri-file-text-line"></i> <span>Send WA Msg</span>
                  </a>
                </li>
              </>
            )}
            <li className="nav-item">
              <a
                className="nav-link menu-link collapsed"
                href="#sidebarIncoming"
                data-bs-toggle="collapse"
                role="button"
                aria-expanded="false"
                aria-controls="sidebarIncoming"
              >
                <i className="ri-file-list-3-line"></i> <span>Incoming</span>
              </a>
              <div className="menu-dropdown collapse" id="sidebarIncoming">
                <ul className="nav nav-sm flex-column">
                  <li className="nav-item">
                    <a href="/chat?s=false" className="nav-link">Messages</a>
                  </li>
                  <li className="nav-item">
                    <a href="/incoming?s=false" className="nav-link">Incoming</a>
                  </li>
                  <li className="nav-item">
                    <a href="/incoming_attachment?s=false" className="nav-link">Attachments</a>
                  </li>
                </ul>
              </div>
            </li>
            {enableAi && (
              <li className="nav-item">
                <a
                  className="nav-link menu-link collapsed"
                  href="#sidebarAi"
                  data-bs-toggle="collapse"
                  role="button"
                  aria-expanded="false"
                  aria-controls="sidebarAi"
                >
                  <i className="ri-layout-grid-line"></i> <span>AI</span>
                </a>
                <div className="menu-dropdown collapse" id="sidebarAi">
                  <ul className="nav nav-sm flex-column">
                    <li className="nav-item">
                      <a href="/knowledge_base?s=false" className="nav-link">Knowledge Based</a>
                    </li>
                    <li className="nav-item">
                      <a href="/do_dont?s=false" className="nav-link">Do&apos;s &amp; Don&apos;ts</a>
                    </li>
                    <li className="nav-item">
                      <a href="/prompts?s=false" className="nav-link">Prompts</a>
                    </li>
                  </ul>
                </div>
              </li>
            )}
            <li className="nav-item">
              <a
                className="nav-link menu-link collapsed"
                href="#sidebarReports"
                data-bs-toggle="collapse"
                role="button"
                aria-expanded="false"
                aria-controls="sidebarReports"
              >
                <i className="ri-layout-grid-line"></i> <span>Reports</span>
              </a>
              <div className="menu-dropdown collapse" id="sidebarReports">
                <ul className="nav nav-sm flex-column">
                  <li className="nav-item">
                    <a href="/que?s=false" className="nav-link">In Que Messages</a>
                  </li>
                  {!hideReports && (
                    <li className="nav-item">
                      <a href="/reports?s=false" className="nav-link">Reports</a>
                    </li>
                  )}
                  <li className="nav-item">
                    <a href="/reports_failed?s=false" className="nav-link">Reports Failed</a>
                  </li>
                  <li className="nav-item">
                    <a href="/reports_error?s=false" className="nav-link">Reports Error</a>
                  </li>
                  <li className="nav-item">
                    <a href="/reports_templates?s=false" className="nav-link">Templates Reports</a>
                  </li>
                </ul>
              </div>
            </li>
            <li className="nav-item">
              <a className="nav-link menu-link" href="/logout">
                <i className="ri-logout-box-r-line"></i> <span data-key="t-logout">Logout</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="sidebar-background"></div>
    </div>
  );
}

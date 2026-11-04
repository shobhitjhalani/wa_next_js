'use client';

/**
 * The bits of the theme's app.js the panels use: the hamburger (collapse the
 * sidebar on desktop, slide it in on mobile), the overlay that closes it, and
 * the fullscreen toggle.
 */

export function HamburgerButton() {
  return (
    <button
      type="button"
      className="btn btn-sm px-3 fs-16 header-item vertical-menu-btn topnav-hamburger"
      id="topnav-hamburger-icon"
      aria-label="Toggle menu"
      onClick={(e) => {
        const html = document.documentElement;
        e.currentTarget.querySelector('.hamburger-icon')?.classList.toggle('open');
        if (window.innerWidth <= 1025) {
          document.body.classList.toggle('vertical-sidebar-enable');
          html.setAttribute('data-sidebar-size', 'lg');
        } else {
          html.setAttribute('data-sidebar-size', html.getAttribute('data-sidebar-size') === 'sm' ? 'lg' : 'sm');
        }
      }}
    >
      <span className="hamburger-icon"><span /><span /><span /></span>
    </button>
  );
}

export function SidebarOverlay() {
  return <div className="vertical-overlay" onClick={() => document.body.classList.remove('vertical-sidebar-enable')} />;
}

export function FullscreenButton() {
  return (
    <button
      type="button"
      className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle"
      aria-label="Fullscreen"
      onClick={() => {
        document.body.classList.toggle('fullscreen-enable');
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }}
    >
      <i className="bx bx-fullscreen fs-22" />
    </button>
  );
}

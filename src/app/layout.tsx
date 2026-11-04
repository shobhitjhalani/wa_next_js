import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import 'flatpickr/dist/flatpickr.min.css';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  title: { default: config.appName, template: `%s | ${config.appName}` },
  icons: { icon: '/assets/images/favicon.ico' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/**
 * Velzon (Bootstrap 5) theme, same as the Laravel app: the theme CSS and
 * Bootstrap's JS bundle (dropdowns, collapses, modals) are served from
 * /public/assets. The theme's own app.js is not loaded — it rewrites the menu
 * DOM, which React owns; the few behaviours it provided live in
 * components/panel/PanelChrome.tsx.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-layout="vertical"
      data-topbar="light"
      data-sidebar="dark"
      data-sidebar-size="lg"
      data-sidebar-image="none"
      data-preloader="disable"
      data-layout-style="default"
      data-bs-theme="light"
      data-layout-width="fluid"
      data-layout-position="fixed"
      suppressHydrationWarning
    >
      <head>
        <link href="/assets/css/bootstrap.min.css" rel="stylesheet" type="text/css" />
        <link href="/assets/css/icons.min.css" rel="stylesheet" type="text/css" />
        <link href="/assets/css/app.min.css" rel="stylesheet" type="text/css" />
        <link href="/assets/css/custom.min.css" rel="stylesheet" type="text/css" />
        <link href="/css/wa.css" rel="stylesheet" type="text/css" />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Script src="/assets/libs/bootstrap/js/bootstrap.bundle.min.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

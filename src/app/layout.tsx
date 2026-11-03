import type { Metadata } from "next";
import Script from "next/script";
import { config } from "@/lib/config";

const A = config.assetsUrl;

export const metadata: Metadata = {
  title: config.siteName,
  icons: { icon: `${A}images/favicon.ico` },
};

// Same theme (Bootstrap 5 "Velzon") the PHP app loads in includes/header.php.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-layout="horizontal"
      data-topbar="light"
      data-sidebar="light"
      data-sidebar-size="lg"
      data-sidebar-image="none"
      data-preloader="disable"
      data-bs-theme="light"
      data-layout-width="fluid"
      data-layout-position="fixed"
      suppressHydrationWarning
    >
      <head>
        <link href={`${A}css/bootstrap.min.css`} rel="stylesheet" />
        <link href={`${A}css/icons.min.css`} rel="stylesheet" />
        <link href={`${A}css/app.min.css`} rel="stylesheet" />
        <link href={`${A}css/custom.min.css`} rel="stylesheet" />
        <Script src={`${A}js/layout.js`} strategy="beforeInteractive" />
      </head>
      <body>
        {children}
        <Script src={`${A}libs/bootstrap/js/bootstrap.bundle.min.js`} strategy="afterInteractive" />
      </body>
    </html>
  );
}

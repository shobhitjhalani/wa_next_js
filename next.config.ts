import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the DigitalOcean droplet (run with PM2).
  output: "standalone",

  // Partner APIs are called at URLs with a trailing slash (/api/secure/v1/send_message/).
  // Next.js would answer those with a 308 redirect, which API clients (PHP curl,
  // Apps Script) do not re-POST, so trailing slashes are handled by the rules below.
  skipTrailingSlashRedirect: true,

  async redirects() {
    return [
      // Old PHP entry points -> new routes, so existing bookmarks keep working.
      { source: "/index.php", destination: "/", permanent: true },
      { source: "/wamaster/index.php", destination: "/wamaster", permanent: true },
      { source: "/:path((?!waapi/).*)\\.php", destination: "/:path", permanent: true },
      // wamaster section index pages (view/<section>/index.php) and the old status endpoint.
      { source: "/wamaster/view/:section/index", destination: "/wamaster/view/:section", permanent: true },
      { source: "/wamaster/view/user/status", destination: "/wamaster/view/user", permanent: false },
      // Pages: keep the usual "strip the trailing slash" behaviour for everything except the APIs.
      {
        source: "/:path((?!api/|wa/secure/|waapi/|_next/).+)/",
        destination: "/:path",
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return {
      // .htaccess rules of the PHP app, applied before pages so POST bodies pass through untouched.
      beforeFiles: [
        { source: "/api/secure/v1/:at/", destination: "/api/legacy/api" },
        { source: "/api/secure/v1/:at", destination: "/api/legacy/api" },
        // ^wa/secure/v1/([^/]+)-([^/]+)/$ -> api.php?at=$1&uk=$2. The handler reads the segments
        // from the original path (src/lib/api/legacy.ts), so destinations carry no query.
        { source: "/wa/secure/v1/:atuk/", destination: "/api/legacy/api" },
        { source: "/wa/secure/v1/:atuk", destination: "/api/legacy/api" },
        { source: "/api/shopify/v1/:at/", destination: "/api/legacy/shopify" },
        { source: "/api/shopify/v1/:at", destination: "/api/legacy/shopify" },
        // Direct script URLs.
        { source: "/waapi/api.php", destination: "/api/legacy/api" },
        { source: "/waapi/client_api.php", destination: "/api/legacy/client" },
        { source: "/waapi/shopify.php", destination: "/api/legacy/shopify" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;

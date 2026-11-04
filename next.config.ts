import type { NextConfig } from 'next';

/**
 * Legacy user pages (bookmarks, emailed links) → current pages. Mirrors the
 * Laravel LegacyRedirectController so old URLs keep working.
 */
const LEGACY_USER_PAGES: Record<string, string> = {
  index: '/',
  dashboard: '/dashboard',
  templates: '/templates',
  templates_add: '/templates',
  compose: '/compose',
  scheduler: '/compose',
  chat: '/chat',
  incoming: '/incoming',
  incoming_attachment: '/incoming_attachment',
  que: '/que',
  reports: '/reports',
  reports_send: '/reports',
  reports_failed: '/reports_failed',
  reports_error: '/reports_error',
  reports_templates: '/reports_templates',
  wa_plans: '/wa_plans',
  recharge: '/recharge',
  success: '/recharge',
  profile: '/profile',
  whatsapp: '/dashboard',
  knowledge_base: '/ai/knowledge_base',
  prompts: '/ai/prompts',
  do_dont: '/ai/do_dont',
};

/** Extensionless legacy pages that were merged or renamed. */
const LEGACY_BARE = ['templates_add', 'scheduler', 'reports_send', 'success', 'whatsapp', 'knowledge_base', 'prompts', 'do_dont'];

const ADMIN_REPORTS: Record<string, string> = {
  wa_send: '/wamaster/reports/messages/send',
  wa_que: '/wamaster/reports/messages/que',
  wa_error: '/wamaster/reports/messages/error',
  wa_system_error: '/wamaster/reports/messages/error',
  error: '/wamaster/reports/messages/error',
  wa_failed: '/wamaster/reports/messages/failed',
  wa_in_process: '/wamaster/reports/messages/in_process',
  index: '/wamaster/reports/messages/send',
  templates: '/wamaster/reports/templates',
  wa_templates: '/wamaster/reports/templates',
  summary: '/wamaster/reports/summary',
  recharges: '/wamaster/reports/recharges',
  recharges_pending: '/wamaster/reports/recharges_pending',
  google_sheets: '/wamaster/reports/google_sheets',
  gs_users: '/wamaster/reports/google_sheets',
  users: '/wamaster/reports/google_sheets',
  wa_users: '/wamaster/reports/wa_users',
};

const nextConfig: NextConfig = {
  // Every page is per-user and rendered at request time.
  cacheComponents: false,
  poweredByHeader: false,
  // Integration clients post to "…/create_wa/" with a trailing slash and do not follow redirects.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ['pg', 'pg-cursor', 'exceljs', 'nodemailer', 'bcryptjs'],
  experimental: {
    // forbidden() → app/forbidden.tsx (403), like Laravel abort(403)
    authInterrupts: true,
    serverActions: {
      // Template header samples go up to 100 MB (documents); campaign media to 16 MB.
      bodySizeLimit: '110mb',
    },
  },
  async redirects() {
    return [
      ...LEGACY_BARE.map((page) => ({ source: `/${page}`, destination: LEGACY_USER_PAGES[page], permanent: true })),
      ...Object.entries(LEGACY_USER_PAGES).map(([page, to]) => ({ source: `/${page}.php`, destination: to, permanent: true })),
      { source: '/wamaster/change_password', destination: '/wamaster/profile', permanent: true },
      { source: '/wamaster/profile.php', destination: '/wamaster/profile', permanent: true },
      { source: '/wamaster/dashboard.php', destination: '/wamaster/dashboard', permanent: true },
      { source: '/wamaster/view/teams', destination: '/wamaster/teams', permanent: true },
      ...Object.entries(ADMIN_REPORTS).map(([page, to]) => ({ source: `/wamaster/view/reports/${page}`, destination: to, permanent: true })),
    ];
  },
};

export default nextConfig;

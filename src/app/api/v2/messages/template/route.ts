import { api, sendTemplate } from '@/lib/api/v2';

/** Send an approved template with parameters, header media and URL button values. */
export const POST = api(sendTemplate, { sending: true });

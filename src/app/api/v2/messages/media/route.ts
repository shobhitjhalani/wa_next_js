import { api, sendMedia } from '@/lib/api/v2';

/** Send an attachment (URL or upload) with an optional caption inside the 24-hour reply window. */
export const POST = api(sendMedia, { sending: true });

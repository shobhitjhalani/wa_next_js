import { api, sendText } from '@/lib/api/v2';

/** Send a text message (optionally with reply buttons) inside the 24-hour reply window. */
export const POST = api(sendText, { sending: true });

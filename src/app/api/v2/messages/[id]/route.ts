import { api, messageStatus } from '@/lib/api/v2';

/** Status of a message sent through the API. */
export const GET = api<{ id: string }>(messageStatus);

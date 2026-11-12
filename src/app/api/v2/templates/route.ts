import { api, createTemplate, listTemplates } from '@/lib/api/v2';

/** GET: the account's templates. POST: create a template (submitted to WhatsApp for review). */
export const GET = api(listTemplates);
export const POST = api(createTemplate);

import { randomUUID } from 'node:crypto';
import { getUser } from '@/lib/auth';
import { exec, one, query } from '@/lib/db';
import { nestedForm, nFile, nList, nObj, nStr, nStrings } from '@/lib/form-nested';
import { contactId, recordMessage } from '@/lib/models';
import { createCampaign } from '@/lib/services/campaigns';
import { UserError, type CardInput } from '@/lib/services/messages';
import { inSendWindow, sendNow, sendWindowLabel } from '@/lib/services/sender';
import type { MessageRow, TemplateRow } from '@/lib/types';
import { bubbles, cleanMobile, contact, convRow, messageById, sameOrigin } from '../inbox';
import type { SendResponse, TemplateListResponse } from '../types';

const MAX_FILE = 16384 * 1024;
const MAX_PARAM = 1024;

function invalid(message: string, status = 422) {
  return Response.json({ message }, { status });
}

/** GET /chat/template — the approved templates the inbox popup can send. */
export async function GET() {
  const user = await getUser();
  if (!user) return invalid('Unauthenticated.', 401);
  const templates = await query<{ ut_id: number; ut_name: string }>(
    'SELECT ut_id, ut_name FROM js_user_templates WHERE ut_user_id = $1 AND ut_dstatus = 0 AND ut_status = 1 ORDER BY ut_name',
    [user.u_id],
  );
  return Response.json(
    { templates, window: { open: inSendWindow(), label: sendWindowLabel() } } satisfies TemplateListResponse,
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /chat/template — send one approved template to the open conversation
 * (a one-recipient campaign, so it shows in the reports like compose), and
 * answer with the rendered bubble like /chat/send. Inside the sending window
 * it goes straight away; outside it stays queued for the worker.
 * Fields: mb, ucode, temp_id, body_parameters[], img_value[], cards[c][media|params[]|url_params[b]].
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return invalid('Unauthenticated.', 401);
  if (!sameOrigin(req)) return invalid('CSRF token mismatch.', 419);

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return invalid('Choose a template.');
  }
  const input = nestedForm(fd);
  const mobile = cleanMobile(nStr(input, 'mb'));
  if (!mobile || mobile.length > 20) return invalid('Open a conversation first.');
  const ucode = nStr(input, 'ucode') || randomUUID();
  if (ucode.length > 100) return invalid('Invalid request.');

  const tempId = parseInt(nStr(input, 'temp_id'), 10) || 0;
  const template = tempId
    ? await one<Pick<TemplateRow, 'ut_id' | 'ut_name' | 'ut_template_type' | 'ut_template_category' | 'ut_cards'>>(
      'SELECT ut_id, ut_name, ut_template_type, ut_template_category, ut_cards FROM js_user_templates WHERE ut_id = $1 AND ut_user_id = $2 AND ut_dstatus = 0 AND ut_status = 1',
      [tempId, user.u_id],
    )
    : null;
  if (!template) return invalid('Choose an approved template.');

  const parameters = nList(input.body_parameters).map((v) => (typeof v === 'string' ? v.trim() : ''));
  if (parameters.some((p) => p === '')) return invalid('Fill in every template value.');
  if (parameters.some((p) => Array.from(p).length > MAX_PARAM)) return invalid(`Template values must not be longer than ${MAX_PARAM} characters.`);

  const headerFiles = nList(input.img_value).filter((f): f is File => f instanceof File && f.size > 0);
  if (headerFiles.some((f) => f.size > MAX_FILE)) return invalid('The header file must not be larger than 16 MB.');

  const cards: CardInput[] = [];
  const cardFiles: (File | null)[] = [];
  for (const [c, card] of Object.entries(nObj(input.cards)).slice(0, 10)) {
    const media = nFile(card, 'media');
    if (media && media.size > MAX_FILE) return invalid(`Card ${Number(c) + 1}: the file must not be larger than 16 MB.`);
    const params = nList(nObj(card).params).map((v) => (typeof v === 'string' ? v.trim() : ''));
    if (params.some((p) => p === '' || Array.from(p).length > MAX_PARAM)) return invalid(`Card ${Number(c) + 1}: fill in every value.`);
    cards[Number(c)] = { params, url_params: nStrings(nObj(card).url_params) };
    cardFiles[Number(c)] = media && media.size > 0 ? media : null;
  }

  let campaignId: number;
  try {
    const campaign = await createCampaign(user, template, {
      name: '',
      uniqueCode: ucode,
      groupIds: [],
      numbers: mobile,
      parameters,
      cards: Array.from(cards, (c) => c ?? {}),
      scheduleAt: null,
    }, headerFiles, Array.from(cardFiles, (f) => f ?? null));
    campaignId = campaign.uc_id;
  } catch (e) {
    if (e instanceof UserError) return invalid(e.message);
    throw e;
  }

  const queued = await one<MessageRow>('SELECT * FROM js_message WHERE m_campaign_id = $1 AND m_user_id = $2 ORDER BY m_id LIMIT 1', [campaignId, user.u_id]);
  if (!queued) return invalid('This number has opted out of messages, so the template was not sent.');

  // Link it to the conversation so the chat list moves it to the top
  const cid = await contactId(user.u_id, queued.m_mobile_no ?? '');
  if (cid) {
    await exec('UPDATE js_message SET m_contact_id = $2 WHERE m_id = $1', [queued.m_id, cid]);
    await recordMessage({ ...queued, m_contact_id: cid });
  }
  const open = inSendWindow();
  if (open) await sendNow(queued.m_id);

  const [m, c] = await Promise.all([messageById(user.u_id, queued.m_id), contact(user.u_id, mobile)]);
  const [b] = await bubbles(user.u_id, [m ?? queued]);
  return Response.json({
    message: b,
    id: b.id,
    error: b.failed ? b.status : null,
    row: convRow(c),
    notice: open ? null : `Queued — campaign messages are sent between ${sendWindowLabel()}, so this goes out when the window opens.`,
  } satisfies SendResponse);
}

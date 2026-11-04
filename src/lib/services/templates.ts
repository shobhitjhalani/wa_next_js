import 'server-only';
import { exec, insertMany, query, tx } from '../db';
import { templateVariables, type TemplateCard } from '../format';
import { now } from '../time';
import type { UserRow } from '../types';
import { createTemplate, fetchTemplates, uploadSample } from './meta';

/**
 * Template sync from Meta (Common::fun_get_templates_meta) and template
 * creation (form → message_templates payload).
 */

type WaUser = Pick<UserRow, 'u_id' | 'u_wa_b_id' | 'u_wa_phone_id'>;

/**
 * Pull the account's templates from Meta into js_user_templates. Returns the
 * number received, or null when the API call failed (existing rows are kept).
 * All rows are written in one transaction (bulk upsert by name).
 */
export async function syncTemplates(user: WaUser): Promise<number | null> {
  if (!user.u_wa_b_id) return null;
  const templates = await fetchTemplates(user);
  if (!templates.length) return null; // keep existing rows rather than deactivating everything on an API error

  const rows = templates.map((tpl) => {
    let headerType = '', headerText = '', footer = '', message = '', buttons = '', parameters = '';
    let cards: string | null = null;
    let type = 'template';
    for (const c of tpl.components ?? []) {
      switch (String(c.type).toUpperCase()) {
        case 'HEADER':
          headerType = c.format ?? '';
          headerText = c.text ?? (c.example?.header_handle ?? []).join(',');
          break;
        case 'BODY':
          message = c.text ?? '';
          parameters = c.example !== undefined ? JSON.stringify(c.example) : '';
          break;
        case 'FOOTER':
          footer = c.text ?? '';
          break;
        case 'BUTTONS':
          buttons = JSON.stringify(c.buttons ?? []);
          if ((c.buttons ?? []).some((b: any) => b.type === 'FLOW')) type = 'flow';
          break;
        case 'CAROUSEL':
          type = 'carousel';
          cards = JSON.stringify((c.cards ?? []).map(card));
          break;
      }
    }
    if (tpl.category === 'AUTHENTICATION') type = 'Authentication';
    return {
      name: String(tpl.name),
      ut_template_type: type,
      ut_template_category: tpl.category ?? null,
      ut_language: tpl.language ?? 'en',
      ut_header_type: headerType,
      ut_header: headerText,
      ut_message: message,
      ut_footer: footer,
      ut_buttons: buttons,
      ut_cards: cards,
      ut_parameters: parameters,
      ut_status: tpl.status === 'APPROVED' ? 1 : 2,
    };
  });

  await tx(async (db) => {
    const existing = await query<{ ut_id: number; ut_name: string }>(
      'SELECT DISTINCT ON (ut_name) ut_id, ut_name FROM js_user_templates WHERE ut_user_id = $1 ORDER BY ut_name, ut_id', [user.u_id], db);
    const ids = new Map(existing.map((r) => [r.ut_name, r.ut_id]));
    await exec('UPDATE js_user_templates SET ut_status = 2 WHERE ut_user_id = $1', [user.u_id], db);

    const fresh: Record<string, unknown>[] = [];
    for (const { name, ...data } of rows) {
      const id = ids.get(name);
      if (id) {
        await exec(
          `UPDATE js_user_templates SET ut_template_type = $2, ut_template_category = $3, ut_language = $4, ut_header_type = $5,
                  ut_header = $6, ut_message = $7, ut_footer = $8, ut_buttons = $9, ut_cards = $10, ut_parameters = $11,
                  ut_status = $12, ut_dstatus = 0 WHERE ut_id = $1`,
          [id, data.ut_template_type, data.ut_template_category, data.ut_language, data.ut_header_type, data.ut_header,
            data.ut_message, data.ut_footer, data.ut_buttons, data.ut_cards, data.ut_parameters, data.ut_status], db);
      } else {
        ids.set(name, -1);
        fresh.push({ ut_user_id: user.u_id, ut_name: name, ut_created_on: now(), ut_dstatus: 0, ...data });
      }
    }
    await insertMany('js_user_templates', fresh, { db });
  });

  return templates.length;
}

/** Flatten one carousel card's components into {header_type, header, body, buttons}. */
function card(c: Record<string, any>): TemplateCard {
  const out: TemplateCard = { header_type: '', header: '', body: '', buttons: [] };
  for (const comp of c.components ?? []) {
    switch (String(comp.type).toUpperCase()) {
      case 'HEADER': out.header_type = comp.format ?? ''; out.header = comp.example?.header_handle?.[0] ?? ''; break;
      case 'BODY': out.body = comp.text ?? ''; break;
      case 'BUTTONS': out.buttons = comp.buttons ?? []; break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ create

export interface ButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | string;
  text: string;
  url?: string;
  example?: string;
  phone?: string;
}

export interface TemplateInput {
  name: string;
  language: string;
  category: string;
  header_type: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | string;
  header_text?: string;
  header_example?: string;
  body: string;
  body_example?: Record<number, string>;
  footer?: string;
  buttons?: ButtonInput[];
}

export interface CarouselInput {
  name: string;
  language: string;
  category: string;
  body: string;
  body_example?: Record<number, string>;
  card_format: 'IMAGE' | 'VIDEO' | string;
  cards: { body: string; body_example?: Record<number, string>; buttons: ButtonInput[] }[];
}

export type CreateResult = { ok: boolean; message: string; status?: string };

const UPLOAD_FAILED: CreateResult = { ok: false, message: 'Could not upload the header sample to WhatsApp. Check FB_APP_ID and the access token.' };

function body(text: string, examples: Record<number, string> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'BODY', text };
  const vars = templateVariables(text);
  if (vars.length) out.example = { body_text: [vars.map((n) => String(examples[n] ?? ''))] };
  return out;
}

function buttons(list: ButtonInput[]): Record<string, unknown> {
  return {
    type: 'BUTTONS',
    buttons: list.map((b) => {
      const button: Record<string, unknown> = { type: b.type, text: b.text };
      if (b.type === 'URL') {
        button.url = b.url;
        if (templateVariables(b.url).length) button.example = [b.example];
      } else if (b.type === 'PHONE_NUMBER') {
        button.phone_number = b.phone;
      }
      return button;
    }),
  };
}

async function upload(file: File | null): Promise<string | null> {
  if (!file) return null;
  return uploadSample(Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream', file.name);
}

async function submit(user: WaUser, data: { name: string; language: string; category: string }, components: unknown[]): Promise<CreateResult> {
  const res = await createTemplate(user, { name: data.name, language: data.language, category: data.category, components });
  if (!res.id) {
    const e = res.error ?? {};
    return { ok: false, message: e.error_user_msg ?? e.message ?? 'WhatsApp rejected the template.' };
  }
  return { ok: true, message: 'Template submitted.', status: res.status ?? 'PENDING' };
}

/** Standard template: optional header (text or media sample), body, footer, buttons. */
export async function createStandardTemplate(user: WaUser, data: TemplateInput, headerFile: File | null): Promise<CreateResult> {
  const components: unknown[] = [];
  if (data.header_type === 'TEXT') {
    const header: Record<string, unknown> = { type: 'HEADER', format: 'TEXT', text: data.header_text };
    if (templateVariables(data.header_text).length) header.example = { header_text: [data.header_example] };
    components.push(header);
  } else if (data.header_type !== 'NONE') {
    const handle = await upload(headerFile);
    if (!handle) return UPLOAD_FAILED;
    components.push({ type: 'HEADER', format: data.header_type, example: { header_handle: [handle] } });
  }
  components.push(body(data.body, data.body_example));
  if (data.footer) components.push({ type: 'FOOTER', text: data.footer });
  if (data.buttons?.length) components.push(buttons(data.buttons));
  return submit(user, data, components);
}

/**
 * Media card carousel: a message bubble followed by 2–10 cards, each with an
 * image/video header, short body and the same button layout.
 */
export async function createCarouselTemplate(user: WaUser, data: CarouselInput, files: (File | null)[]): Promise<CreateResult> {
  const cards = [];
  for (let i = 0; i < data.cards.length; i++) {
    const handle = await upload(files[i] ?? null);
    if (!handle) return UPLOAD_FAILED;
    const c = data.cards[i];
    cards.push({ components: [
      { type: 'HEADER', format: data.card_format, example: { header_handle: [handle] } },
      body(c.body, c.body_example),
      buttons(c.buttons),
    ] });
  }
  return submit(user, data, [body(data.body, data.body_example), { type: 'CAROUSEL', cards }]);
}

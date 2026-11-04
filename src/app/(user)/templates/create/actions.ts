'use server';

import { forbidden, redirect } from 'next/navigation';
import { fail, fileExt, flash, invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { templateVariables } from '@/lib/format';
import { nestedForm, nFile, nList, nObj, nStr, nStrings, type NestedValue } from '@/lib/form-nested';
import {
  createCarouselTemplate, createStandardTemplate, syncTemplates,
  type ButtonInput, type CarouselInput, type TemplateInput,
} from '@/lib/services/templates';
import { LANGUAGES } from './languages';

/** Upload rules for sample header media, by header format (extension check + size in KB). */
const FILE_RULES: Record<string, { ext: string[]; max: number }> = {
  IMAGE: { ext: ['jpg', 'jpeg', 'png'], max: 5120 },
  VIDEO: { ext: ['mp4'], max: 16384 },
  DOCUMENT: { ext: ['pdf'], max: 102400 },
};
const BUTTON_TYPES = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'];
const PHONE = /^\+?\d{8,15}$/;

/** Laravel's displayable attribute name: "header_text" → "header text". */
const attr = (key: string) => key.replace(/_/g, ' ');

/** Collects the first message per field, like Laravel's validator + $errors->first(). */
class Errors {
  list: Record<string, string> = {};
  add(key: string, msg: string) { if (!(key in this.list)) this.list[key] = msg; }
  get any() { return Object.keys(this.list).length > 0; }

  required(key: string, v: string, msg?: string): boolean {
    if (v !== '') return true;
    this.add(key, msg ?? `The ${attr(key)} field is required.`);
    return false;
  }
  max(key: string, v: string, n: number) {
    if (Array.from(v).length > n) this.add(key, `The ${attr(key)} field must not be greater than ${n} characters.`);
  }
  in(key: string, v: string, list: string[]) {
    if (v !== '' && !list.includes(v)) this.add(key, `The selected ${attr(key)} is invalid.`);
  }
  startsWith(key: string, v: string) {
    if (v !== '' && !v.startsWith('http://') && !v.startsWith('https://')) {
      this.add(key, `The ${attr(key)} field must start with one of the following: http://, https://.`);
    }
  }
  regex(key: string, v: string, re: RegExp, msg?: string) {
    if (v !== '' && !re.test(v)) this.add(key, msg ?? `The ${attr(key)} field format is invalid.`);
  }
  file(key: string, f: File | null, rule: { ext: string[]; max: number } | undefined) {
    if (!f || !rule) return;
    if (!rule.ext.includes(fileExt(f))) this.add(key, `The ${attr(key)} field must be a file of type: ${rule.ext.join(', ')}.`);
    else if (f.size > rule.max * 1024) this.add(key, `The ${attr(key)} field must not be greater than ${rule.max} kilobytes.`);
  }
}

function strings(v: NestedValue | undefined, key: string, e: Errors, max: number): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, s] of Object.entries(nStrings(v))) {
    e.max(`${key}.${k}`, s, max);
    out[Number(k)] = s;
  }
  return out;
}

/** Placeholders must run {{1}}..{{n}} with a sample value for each. */
function checkBody(text: string, examples: Record<number, string>, field: string, exampleField: string, e: Errors) {
  const vars = templateVariables(text);
  if (vars.length && vars.some((n, i) => n !== i + 1)) {
    e.add(field, 'Variables must be numbered in order: {{1}}, {{2}}, {{3}}…');
    return;
  }
  for (const n of vars) if (!examples[n]) e.add(`${exampleField}.${n}`, `Enter a sample value for {{${n}}}.`);
}

/** A URL button can end with a single {{1}} and then needs a sample URL. */
function checkButton(b: ButtonInput, field: string, e: Errors) {
  const urlVars = b.type === 'URL' ? templateVariables(b.url ?? '') : [];
  if (!urlVars.length) return;
  if (urlVars.length !== 1 || urlVars[0] !== 1 || !(b.url ?? '').trimEnd().endsWith('}}')) {
    e.add(`${field}.url`, 'A URL button can have one variable, {{1}}, at the end of the URL.');
  } else if (!b.example) {
    e.add(`${field}.example`, 'Enter a sample full URL for the URL button.');
  }
}

/** Create a template and submit it to Meta for review (User\TemplateController::store). */
export async function storeTemplate(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.u_wa_b_id) forbidden();

  const input = nestedForm(fd);
  const e = new Errors();
  const kind = nStr(input, 'kind');
  const carousel = kind === 'CAROUSEL';

  if (e.required('kind', kind)) e.in('kind', kind, ['STANDARD', 'CAROUSEL']);
  const name = nStr(input, 'name');
  if (e.required('name', name)) {
    e.max('name', name, 512);
    e.regex('name', name, /^[a-z0-9_]+$/, 'Template name may only contain lowercase letters, numbers and underscores.');
  }
  const category = nStr(input, 'category');
  if (e.required('category', category)) e.in('category', category, ['MARKETING', 'UTILITY']);
  const language = nStr(input, 'language');
  if (e.required('language', language)) e.in('language', language, Object.keys(LANGUAGES));
  const body = nStr(input, 'body');
  if (e.required('body', body)) e.max('body', body, 1024);
  const bodyExample = strings(input.body_example, 'body_example', e, 200);

  if (carousel) {
    // "None" for the second card button arrives as an empty type
    const layout = nList(input.card_buttons).filter((b) => nStr(b, 'type') !== '');
    const cardFormat = nStr(input, 'card_format');
    if (e.required('card_format', cardFormat)) e.in('card_format', cardFormat, ['IMAGE', 'VIDEO']);
    if (!layout.length) e.add('card_buttons', 'The card buttons field is required.');
    else if (layout.length > 2) e.add('card_buttons', 'The card buttons field must not have more than 2 items.');
    layout.forEach((b, i) => e.in(`card_buttons.${i}.type`, nStr(b, 'type'), BUTTON_TYPES));

    const rawCards = nList(input.cards);
    if (!rawCards.length) e.add('cards', 'The cards field is required.');
    else if (rawCards.length < 2) e.add('cards', 'A carousel needs at least 2 cards.');
    else if (rawCards.length > 10) e.add('cards', 'The cards field must not have more than 10 items.');
    const rule = FILE_RULES[cardFormat] ?? FILE_RULES.IMAGE;
    const files: (File | null)[] = [];
    const cards = rawCards.map((card, c) => {
      const file = nFile(card, 'file');
      if (!file) e.add(`cards.${c}.file`, 'Upload a sample image or video for every card.');
      e.file(`cards.${c}.file`, file, rule);
      files.push(file);
      const cardBody = nStr(card, 'body');
      if (e.required(`cards.${c}.body`, cardBody)) e.max(`cards.${c}.body`, cardBody, 160);
      const examples = strings(nObj(card).body_example, `cards.${c}.body_example`, e, 200);
      const btns = nObj(nObj(card).buttons);
      if (!Object.keys(btns).length) e.add(`cards.${c}.buttons`, `The cards.${c}.buttons field is required.`);
      const slot = (i: number) => btns[String(i)];
      Object.entries(btns).forEach(([i, b]) => {
        const f = `cards.${c}.buttons.${i}`;
        const text = nStr(b, 'text');
        if (e.required(`${f}.text`, text)) e.max(`${f}.text`, text, 25);
        const url = nStr(b, 'url');
        e.max(`${f}.url`, url, 2000);
        e.startsWith(`${f}.url`, url);
        const phone = nStr(b, 'phone');
        e.max(`${f}.phone`, phone, 20);
        e.regex(`${f}.phone`, phone, PHONE);
        e.max(`${f}.example`, nStr(b, 'example'), 2000);
      });
      return { body: cardBody, body_example: examples, slot };
    });
    if (e.any) return invalid(e.list);

    checkBody(body, bodyExample, 'body', 'body_example', e);
    const data: CarouselInput = {
      name, language, category, body, body_example: bodyExample, card_format: cardFormat,
      cards: cards.map((card, c) => {
        checkBody(card.body, card.body_example, `cards.${c}.body`, `cards.${c}.body_example`, e);
        const buttons = layout.map((slotDef, i) => {
          const src = card.slot(i);
          const b: ButtonInput = {
            type: nStr(slotDef, 'type'), text: nStr(src, 'text'), url: nStr(src, 'url') || undefined,
            phone: nStr(src, 'phone') || undefined, example: nStr(src, 'example') || undefined,
          };
          const field = `cards.${c}.buttons.${i}`;
          if (!b.text) e.add(`${field}.text`, `Card ${c + 1}: enter text for button ${i + 1}.`);
          else if (b.type === 'URL' && !b.url) e.add(`${field}.url`, `Card ${c + 1}: enter the URL for button ${i + 1}.`);
          else if (b.type === 'PHONE_NUMBER' && !b.phone) e.add(`${field}.phone`, `Card ${c + 1}: enter the phone number for button ${i + 1}.`);
          else checkButton(b, field, e);
          return b;
        });
        return { body: card.body, body_example: card.body_example, buttons };
      }),
    };
    if (e.any) return invalid(e.list);
    const result = await createCarouselTemplate(user, data, files);
    if (!result.ok) return fail(result.message);
    return finish(user, name, result.status);
  }

  // Standard template
  const headerType = nStr(input, 'header_type');
  if (e.required('header_type', headerType)) e.in('header_type', headerType, ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']);
  const headerText = nStr(input, 'header_text');
  if (headerType === 'TEXT') e.required('header_text', headerText, 'The header text field is required when header type is TEXT.');
  e.max('header_text', headerText, 60);
  const headerExample = nStr(input, 'header_example');
  e.max('header_example', headerExample, 200);
  const headerFile = nFile(input, 'header_file');
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && !headerFile) e.add('header_file', 'Upload a sample file for the media header.');
  e.file('header_file', headerFile, FILE_RULES[headerType]);
  const footer = nStr(input, 'footer');
  e.max('footer', footer, 60);
  const rawButtons = nList(input.buttons);
  if (rawButtons.length > 10) e.add('buttons', 'The buttons field must not have more than 10 items.');
  const buttons: ButtonInput[] = rawButtons.map((b, i) => {
    const f = `buttons.${i}`;
    const type = nStr(b, 'type');
    if (e.required(`${f}.type`, type)) e.in(`${f}.type`, type, BUTTON_TYPES);
    const text = nStr(b, 'text');
    if (e.required(`${f}.text`, text)) e.max(`${f}.text`, text, 25);
    const url = nStr(b, 'url');
    if (type === 'URL' && !url) e.add(`${f}.url`, `The ${f}.url field is required when ${f}.type is URL.`);
    e.max(`${f}.url`, url, 2000);
    e.startsWith(`${f}.url`, url);
    const phone = nStr(b, 'phone');
    if (type === 'PHONE_NUMBER' && !phone) e.add(`${f}.phone`, `The ${f}.phone field is required when ${f}.type is PHONE_NUMBER.`);
    e.max(`${f}.phone`, phone, 20);
    e.regex(`${f}.phone`, phone, PHONE, 'Phone number must include the country code, e.g. +919876543210.');
    const example = nStr(b, 'example');
    e.max(`${f}.example`, example, 2000);
    return { type, text, url: url || undefined, phone: phone || undefined, example: example || undefined };
  });
  if (e.any) return invalid(e.list);

  checkBody(body, bodyExample, 'body', 'body_example', e);
  const headerVars = headerType === 'TEXT' ? templateVariables(headerText) : [];
  if (headerVars.length && (headerVars.length !== 1 || headerVars[0] !== 1)) {
    e.add('header_text', 'The header can contain only one variable, {{1}}.');
  } else if (headerVars.length && !headerExample) {
    e.add('header_example', 'Enter a sample value for the header variable.');
  }
  buttons.forEach((b, i) => checkButton(b, `buttons.${i}`, e));
  if (e.any) return invalid(e.list);

  const data: TemplateInput = {
    name, language, category, header_type: headerType,
    header_text: headerText || undefined, header_example: headerExample || undefined,
    body, body_example: bodyExample, footer: footer || undefined, buttons,
  };
  const result = await createStandardTemplate(user, data, headerFile);
  if (!result.ok) return fail(result.message);
  return finish(user, name, result.status);
}

async function finish(user: Parameters<typeof syncTemplates>[0], name: string, status?: string): Promise<never> {
  await syncTemplates(user);
  await flash('success', status === 'APPROVED'
    ? `Template “${name}” was approved and is ready to send.`
    : `Template “${name}” submitted to WhatsApp (status: ${status}). It appears here once approved — use “Sync from WhatsApp” to refresh.`);
  redirect('/templates');
}

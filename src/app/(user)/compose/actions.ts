'use server';

import { notFound, redirect } from 'next/navigation';
import { fail, flash, invalid, type ActionResult } from '@/lib/actions';
import { requireTeam } from '@/lib/auth';
import { exec, one, query, value } from '@/lib/db';
import { nestedForm, nFile, nList, nObj, nStr, nStrings } from '@/lib/form-nested';
import { createCampaign } from '@/lib/services/campaigns';
import { ImportError, NUMBER_FILE_EXTENSIONS, readNumbersFile } from '@/lib/services/contacts-import';
import { UserError, type CardInput } from '@/lib/services/messages';
import { numberFormat } from '@/lib/text';
import { now, parseDate, phpDate } from '@/lib/time';
import type { CampaignRow, TemplateRow } from '@/lib/types';

const MAX_FILE = 16384 * 1024;

/** Create a campaign and send it now or schedule it (User\ComposeController::store). */
export async function storeCampaign(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { user, member, perms } = await requireTeam((p) => p.campaignCreate);
  const input = nestedForm(fd);
  const errors: Record<string, string> = {};
  const add = (k: string, m: string) => { if (!(k in errors)) errors[k] = m; };

  const tempIdRaw = nStr(input, 'temp_id');
  if (!tempIdRaw) add('temp_id', 'The temp id field is required.');
  else if (!/^-?\d+$/.test(tempIdRaw)) add('temp_id', 'The temp id field must be an integer.');

  const campaignName = nStr(input, 'campaign_name');
  if (Array.from(campaignName).length > 150) add('campaign_name', 'The campaign name field must not be greater than 150 characters.');

  const groupValues = nList(input.groups).map((v) => (typeof v === 'string' ? v : ''));
  const groupIds = groupValues.map((v) => (/^\d+$/.test(v) ? parseInt(v, 10) : 0));
  if (groupIds.length) {
    const owned = new Set((await query<{ ug_id: number }>(
      'SELECT ug_id FROM js_user_groups WHERE ug_id = ANY($1::int[]) AND ug_user_id = $2',
      [groupIds.filter((n) => n > 0 && n < 2147483648), user.u_id],
    )).map((r) => r.ug_id));
    groupIds.forEach((id, i) => { if (!owned.has(id)) add(`groups.${i}`, `The selected groups.${i} is invalid.`); });
  }

  const parameters = nList(input.body_parameters).map((v) => (typeof v === 'string' ? v : ''));
  parameters.forEach((p, i) => { if (Array.from(p).length > 1024) add(`body_parameters.${i}`, `The body parameters.${i} field must not be greater than 1024 characters.`); });

  const headerFiles = nList(input.img_value).filter((f): f is File => f instanceof File);
  headerFiles.forEach((f, i) => { if (f.size > MAX_FILE) add(`img_value.${i}`, `The img value.${i} field must not be greater than 16384 kilobytes.`); });

  const ucode = nStr(input, 'ucode');
  if (!ucode) add('ucode', 'The ucode field is required.');
  else if (ucode.length > 100) add('ucode', 'The ucode field must not be greater than 100 characters.');

  const rawCards = nObj(input.cards);
  if (Object.keys(rawCards).length > 10) add('cards', 'The cards field must not have more than 10 items.');
  const cards: CardInput[] = [];
  const cardFiles: (File | null)[] = [];
  for (const [c, card] of Object.entries(rawCards)) {
    const media = nFile(card, 'media');
    if (media && media.size > MAX_FILE) add(`cards.${c}.media`, `The cards.${c}.media field must not be greater than 16384 kilobytes.`);
    const params = nList(nObj(card).params).map((v) => (typeof v === 'string' ? v : ''));
    params.forEach((p, i) => { if (Array.from(p).length > 1024) add(`cards.${c}.params.${i}`, `The cards.${c}.params.${i} field must not be greater than 1024 characters.`); });
    const urlParams = nStrings(nObj(card).url_params);
    for (const [b, u] of Object.entries(urlParams)) {
      if (Array.from(u).length > 2000) add(`cards.${c}.url_params.${b}`, `The cards.${c}.url_params.${b} field must not be greater than 2000 characters.`);
    }
    cards[Number(c)] = { params, url_params: urlParams };
    cardFiles[Number(c)] = media;
  }

  const sendMode = nStr(input, 'send_mode');
  if (!sendMode) add('send_mode', 'The send mode field is required.');
  else if (sendMode !== 'now' && sendMode !== 'later') add('send_mode', 'The selected send mode is invalid.');

  const scheduleRaw = nStr(input, 'schedule_at');
  let scheduleAt: number | null = null;
  if (scheduleRaw) {
    scheduleAt = parseDate(scheduleRaw);
    if (scheduleAt === null) add('schedule_at', 'The schedule at field must be a valid date.');
    else if (scheduleAt <= now()) add('schedule_at', 'The scheduled time must be in the future.');
  } else if (sendMode === 'later') {
    add('schedule_at', 'Choose when to send the campaign.');
  }

  // Variables taken from a column of the uploaded file: param_columns[i] = column index ('' = typed value)
  const paramColumns = nList(input.param_columns).map((v) => (typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : -1));
  const mapped = paramColumns.map((c, i) => [i, c] as const).filter(([, c]) => c >= 0);
  const fromFileVars = mapped.length > 0;
  let rowVars: { index: number[]; values: Map<string, string[]> } | undefined;
  let emptyValues = 0;
  if (fromFileVars) {
    if (groupIds.length || nStr(input, 'txt_contact')) {
      add('contact_file', 'Variables come from the Excel file, so the campaign goes to the file’s numbers only: untick the contact groups and clear the typed numbers.');
    }
  }
  // Typed values are required for the variables not taken from the file
  parameters.forEach((p, i) => { if (!mapped.some(([m]) => m === i) && !p.trim()) add(`body_parameters.${i}`, `Enter the value of {{${i + 1}}}.`); });

  // Audience from an uploaded Excel / CSV file (Audience → Excel Upload)
  let fileNumbers: string[] = [];
  const audienceFile = fd.get('contact_file');
  if (fromFileVars && !(audienceFile instanceof File && audienceFile.size)) add('contact_file', 'Upload the Excel file the variables come from.');
  if (audienceFile instanceof File && audienceFile.size) {
    const ext = audienceFile.name.split('.').pop()?.toLowerCase() ?? '';
    if (!NUMBER_FILE_EXTENSIONS.includes(ext)) add('contact_file', 'Upload an .xlsx, .csv or .txt file.');
    else if (audienceFile.size > 10 * 1024 * 1024) add('contact_file', 'The file must not be larger than 10 MB.');
    else {
      try {
        const r = await readNumbersFile({ bytes: Buffer.from(await audienceFile.arrayBuffer()), extension: ext }, mapped.map(([, c]) => c));
        fileNumbers = r.numbers;
        if (fromFileVars) {
          const bad = mapped.find(([, c]) => c >= r.headings.length || c === r.mobileColumn);
          if (bad) add(`body_parameters.${bad[0]}`, `Choose another column for {{${bad[0] + 1}}}.`);
          // WhatsApp allows at most 1024 characters per variable
          for (const [n, vals] of r.values) r.values.set(n, vals.map((v) => Array.from(v).slice(0, 1024).join('')));
          rowVars = { index: mapped.map(([i]) => i), values: r.values };
          emptyValues = r.emptyValues;
          if (!fileNumbers.length) add('contact_file', r.emptyValues ? 'Every row leaves a mapped column empty, so no message can be sent.' : 'The file has no valid mobile numbers.');
        } else if (!fileNumbers.length) add('contact_file', 'The file has no valid mobile numbers.');
      } catch (e) {
        if (e instanceof ImportError) add('contact_file', e.message);
        else throw e;
      }
    }
  }
  // Chatbot Flow started by replies to the campaign (optional; an active flow of the account)
  const flowRaw = nStr(input, 'bot_flow_id');
  let botFlowId = 0;
  if (flowRaw) {
    const ok = /^\d+$/.test(flowRaw) && Number(user.u_bot_flow) === 1
      && await value<number>('SELECT bf_id FROM js_bot_flow WHERE bf_id = $1 AND bf_user_id = $2 AND bf_status = 1', [Number(flowRaw), user.u_id]);
    if (ok) botFlowId = Number(flowRaw);
    else add('bot_flow_id', 'Choose an active Chatbot Flow.');
  }
  if (Object.keys(errors).length) return invalid(errors);

  const template = await one<Pick<TemplateRow, 'ut_id' | 'ut_name' | 'ut_template_type' | 'ut_template_category' | 'ut_cards'>>(
    'SELECT ut_id, ut_name, ut_template_type, ut_template_category, ut_cards FROM js_user_templates WHERE ut_id = $1 AND ut_user_id = $2 AND ut_dstatus = 0',
    [parseInt(tempIdRaw, 10), user.u_id],
  );
  if (!template) notFound();

  let campaign: CampaignRow;
  try {
    campaign = await createCampaign(user, template, {
      name: campaignName,
      uniqueCode: ucode,
      groupIds,
      numbers: [nStr(input, 'txt_contact'), ...fileNumbers].filter(Boolean).join('\n'),
      parameters,
      cards: Array.from(cards, (c) => c ?? {}),
      scheduleAt: sendMode === 'later' ? scheduleAt : null,
      rowVars,
      botFlowId,
    }, headerFiles, Array.from(cardFiles, (f) => f ?? null));
  } catch (e) {
    if (e instanceof UserError) return fail(e.message);
    throw e;
  }

  // Remember which team member created it ("view own campaigns")
  if (member) await exec('UPDATE js_user_campaign SET uc_member_id = $2 WHERE uc_id = $1', [campaign.uc_id, member.um_id]);

  await flash('success', (sendMode === 'later'
    ? `Campaign scheduled for ${phpDate('d M Y, H:i', campaign.uc_scheduled_at)}.`
    : `${numberFormat(campaign.uc_total_contacts)} message(s) queued${campaign.uc_skipped ? ` (${numberFormat(campaign.uc_skipped)} opted-out number(s) skipped)` : ''}.`)
    + (emptyValues ? ` ${numberFormat(emptyValues)} row(s) of the file were skipped: a mapped column was empty.` : ''));
  redirect(perms.campaignView === 'none' ? '/compose' : `/campaigns/${campaign.uc_id}`);
}

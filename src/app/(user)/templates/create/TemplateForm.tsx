'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import type { ActionResult } from '@/lib/actions';

/**
 * Template create form with carousel support and live preview
 * (templates/create.blade.php + _button_row + _card and their jQuery).
 * Field names match the Laravel form, e.g. buttons[0][type], cards[0][file].
 */

const FILE_HINTS: Record<string, [string, string]> = {
  IMAGE: ['image/png,image/jpeg', 'JPG or PNG, up to 5 MB'],
  VIDEO: ['video/mp4', 'MP4, up to 16 MB'],
  DOCUMENT: ['application/pdf', 'PDF, up to 100 MB'],
};
const ICONS: Record<string, string> = { QUICK_REPLY: 'ri-reply-line', URL: 'ri-external-link-line', PHONE_NUMBER: 'ri-phone-line', FLOW: 'ri-survey-line' };
const BUTTON_TYPES: [string, string][] = [['QUICK_REPLY', 'Quick reply'], ['URL', 'Visit website'], ['PHONE_NUMBER', 'Call phone']];
/** Standard templates can also open a WhatsApp Flow (one per template). */
const STANDARD_BUTTON_TYPES: [string, string][] = [...BUTTON_TYPES, ['FLOW', 'Open flow (form)']];
const HEADER_TYPES: [string, string][] = [['NONE', 'None'], ['TEXT', 'Text'], ['IMAGE', 'Image'], ['VIDEO', 'Video'], ['DOCUMENT', 'Document']];
const OPEN = '{{', CLOSE = '}}';

function vars(text: string): number[] {
  const found = new Set<number>();
  for (const m of (text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(+m[1]);
  return [...found].sort((a, b) => a - b);
}
function fill(text: string, samples: Record<number, string>): string {
  return (text || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n) => samples[+n] || all);
}

interface Btn { key: number; type: string; text: string; url: string; phone: string; example: string; flowId: string; screen: string }
export interface FlowOption { id: string; name: string; status: string }
interface SlotBtn { text: string; url: string; phone: string; example: string }
interface Card { key: number; body: string; examples: Record<number, string>; buttons: [SlotBtn, SlotBtn]; file: File | null }

const emptySlot = (): SlotBtn => ({ text: '', url: '', phone: '', example: '' });
const newCard = (key: number): Card => ({ key, body: '', examples: {}, buttons: [emptySlot(), emptySlot()], file: null });

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function TemplateForm({ action, languages, initialKind, flows, categories }: {
  action: Action; languages: Record<string, string>; initialKind: 'STANDARD' | 'CAROUSEL';
  /** Categories this account may create (admin-set; usually Marketing and Utility). */
  categories: ('MARKETING' | 'UTILITY')[];
  /** The account's WhatsApp Flows; null when they couldn't be loaded (the Flow ID is typed instead). */
  flows: FlowOption[] | null;
}) {
  const [kind, setKind] = useState(initialKind);
  const carousel = kind === 'CAROUSEL';
  const [name, setName] = useState('');
  const [headerType, setHeaderType] = useState('NONE');
  const [headerText, setHeaderText] = useState('');
  const [headerExample, setHeaderExample] = useState('');
  const [headerFile, setHeaderFile] = useState<File | null>(null);
  const [body, setBody] = useState('');
  const [bodyExamples, setBodyExamples] = useState<Record<number, string>>({});
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [cardFormat, setCardFormat] = useState('IMAGE');
  const [slots, setSlots] = useState<[string, string]>(['QUICK_REPLY', '']);
  const [cards, setCards] = useState<Card[]>(() => [newCard(0), newCard(1)]);
  const nextKey = useRef({ button: 0, card: 2 });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef(new Map<number, HTMLTextAreaElement>());

  const media = FILE_HINTS[headerType];
  const headerVars = vars(headerText);
  const bodyText = fill(body, bodyExamples) || 'Your message text appears here.';

  /** Insert the next {{n}} at the cursor (the "+ Add variable" links). */
  function addVariable(el: HTMLTextAreaElement | null | undefined, current: string, set: (v: string) => void) {
    const token = OPEN + ((vars(current).pop() || 0) + 1) + CLOSE;
    const pos = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd || pos;
    set(current.slice(0, pos) + token + current.slice(end));
    el?.focus();
  }

  const updateButton = (key: number, patch: Partial<Btn>) => setButtons((list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const updateCard = (key: number, patch: Partial<Card>) => setCards((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const updateSlot = (card: Card, s: 0 | 1, patch: Partial<SlotBtn>) => {
    const next = [...card.buttons] as [SlotBtn, SlotBtn];
    next[s] = { ...next[s], ...patch };
    updateCard(card.key, { buttons: next });
  };

  return (
    <ActionForm action={action} id="template_form">
      <div className="row g-4">
        <div className="col-lg-7">
          <div className="mb-3">
            <span className="form-label d-block">Template Type</span>
            <div className="btn-group" role="group" aria-label="Template type">
              <input type="radio" className="btn-check" name="kind" id="kind_standard" value="STANDARD" checked={!carousel} onChange={() => setKind('STANDARD')} />
              <label className="btn btn-outline-primary" htmlFor="kind_standard"><i className="ri-message-2-line" /> Standard</label>
              <input type="radio" className="btn-check" name="kind" id="kind_carousel" value="CAROUSEL" checked={carousel} onChange={() => setKind('CAROUSEL')} />
              <label className="btn btn-outline-primary" htmlFor="kind_carousel"><i className="ri-carousel-view" /> Carousel</label>
            </div>
            <div className="form-text" id="kind_hint">
              {carousel
                ? 'A message followed by 2–10 swipeable cards, each with an image or video, text and buttons.'
                : 'A single message with optional header, footer and buttons.'}
            </div>
          </div>

          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <label htmlFor="name" className="form-label">Template Name <span className="text-danger">*</span></label>
              <input
                type="text" className="form-control" name="name" id="name" value={name} maxLength={512} pattern="[a-z0-9_]+" placeholder="order_update" required
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              />
              <div className="form-text">Lowercase letters, numbers and underscores only.</div>
              <FieldError name="name" />
            </div>
            <div className="col-md-3">
              <label htmlFor="category" className="form-label">Category <span className="text-danger">*</span></label>
              <select className="form-select" name="category" id="category" required defaultValue={categories[0]}>
                {categories.map((c) => <option key={c} value={c}>{c === 'MARKETING' ? 'Marketing' : 'Utility'}</option>)}
              </select>
              <FieldError name="category" />
            </div>
            <div className="col-md-3">
              <label htmlFor="language" className="form-label">Language <span className="text-danger">*</span></label>
              <select className="form-select" name="language" id="language" required defaultValue="en">
                {Object.entries(languages).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
          </div>

          <fieldset id="standard_header" disabled={carousel} hidden={carousel}>
            <div className="mb-3">
              <label htmlFor="header_type" className="form-label">Header <span className="text-muted">(optional)</span></label>
              <select className="form-select" name="header_type" id="header_type" value={headerType} onChange={(e) => setHeaderType(e.target.value)}>
                {HEADER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="row g-3 mb-3" id="header_text_wrap" hidden={headerType !== 'TEXT'}>
              <div className="col-md-7">
                <label htmlFor="header_text" className="form-label">Header Text</label>
                <input type="text" className="form-control" name="header_text" id="header_text" value={headerText} maxLength={60} onChange={(e) => setHeaderText(e.target.value)} />
                <div className="form-text">Up to 60 characters. One variable allowed: {'{{1}}'}</div>
                <FieldError name="header_text" />
              </div>
              <div className="col-md-5" id="header_example_wrap" hidden={headerType !== 'TEXT' || !headerVars.length}>
                <label htmlFor="header_example" className="form-label">Sample for {'{{1}}'}</label>
                <input type="text" className="form-control" name="header_example" id="header_example" value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} />
                <FieldError name="header_example" />
              </div>
            </div>
            <div className="mb-3" id="header_file_wrap" hidden={!media}>
              <label htmlFor="header_file" className="form-label">Sample Header File</label>
              <input
                type="file" className="form-control" name="header_file" id="header_file" required={!!media && !carousel} accept={media?.[0]}
                onChange={(e) => setHeaderFile(e.target.files?.[0] ?? null)}
              />
              <div className="form-text" id="header_file_hint">
                {media ? `${media[1]}. WhatsApp uses it only as a review sample; you choose the real file when sending.` : ''}
              </div>
              <FieldError name="header_file" />
            </div>
          </fieldset>

          <div className="mb-3">
            <label htmlFor="body" className="form-label"><span id="body_label">{carousel ? 'Message Text (shown above the cards)' : 'Body'}</span> <span className="text-danger">*</span></label>
            <textarea ref={bodyRef} className="form-control" name="body" id="body" rows={6} maxLength={1024} required value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="d-flex justify-content-between form-text">
              <span>Use {'{{1}}'}, {'{{2}}'}… for values filled in when sending. *bold*, _italic_ and ~strike~ are supported.</span>
              <button type="button" className="btn btn-link btn-sm p-0 add-variable" onClick={() => addVariable(bodyRef.current, body, setBody)}>+ Add variable</button>
            </div>
            <FieldError name="body" />
          </div>
          <Examples text={body} name="body_example" values={bodyExamples} onChange={setBodyExamples} className="row g-3 mb-3 examples" />

          <fieldset id="standard_footer" disabled={carousel} hidden={carousel}>
            <div className="mb-3">
              <label htmlFor="footer" className="form-label">Footer <span className="text-muted">(optional)</span></label>
              <input type="text" className="form-control" name="footer" id="footer" value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} />
            </div>

            <div className="mb-3">
              <div className="d-flex align-items-center mb-2">
                <span className="form-label mb-0 me-auto">Buttons <span className="text-muted">(optional, up to 10)</span></span>
                <button
                  type="button" className="btn btn-sm btn-soft-primary" id="add_button"
                  onClick={() => {
                    if (buttons.length >= 10) return;
                    setButtons((list) => [...list, { key: nextKey.current.button++, type: 'QUICK_REPLY', text: '', url: '', phone: '', example: '', flowId: '', screen: '' }]);
                  }}
                >
                  <i className="ri-add-line" /> Add Button
                </button>
              </div>
              <div id="buttons">
                {buttons.map((b) => {
                  const i = b.key;
                  return (
                    <div className="button-row border rounded p-2 mb-2" key={i}>
                      <div className="row g-2 align-items-end">
                        <div className="col-md-3">
                          <label className="form-label small mb-1" htmlFor={`btn_type_${i}`}>Type</label>
                          <select className="form-select form-select-sm btn-type" name={`buttons[${i}][type]`} id={`btn_type_${i}`} value={b.type} onChange={(e) => updateButton(i, { type: e.target.value })}>
                            {STANDARD_BUTTON_TYPES
                              .filter(([v]) => v !== 'FLOW' || b.type === 'FLOW' || !buttons.some((x) => x.type === 'FLOW'))
                              .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small mb-1" htmlFor={`btn_text_${i}`}>Button Text</label>
                          <input type="text" className="form-control form-control-sm btn-text" name={`buttons[${i}][text]`} id={`btn_text_${i}`} value={b.text} maxLength={25} required onChange={(e) => updateButton(i, { text: e.target.value })} />
                        </div>
                        <div className="col-md-5 btn-url-wrap" hidden={b.type !== 'URL'}>
                          <label className="form-label small mb-1" htmlFor={`btn_url_${i}`}>URL <span className="text-muted">(may end with {'{{1}}'})</span></label>
                          <input type="text" className="form-control form-control-sm btn-url" name={`buttons[${i}][url]`} id={`btn_url_${i}`} value={b.url} maxLength={2000} placeholder="https://example.com/order/{{1}}" required={b.type === 'URL'} onChange={(e) => updateButton(i, { url: e.target.value })} />
                        </div>
                        <div className="col-md-5 btn-phone-wrap" hidden={b.type !== 'PHONE_NUMBER'}>
                          <label className="form-label small mb-1" htmlFor={`btn_phone_${i}`}>Phone Number</label>
                          <input type="text" className="form-control form-control-sm btn-phone" name={`buttons[${i}][phone]`} id={`btn_phone_${i}`} value={b.phone} maxLength={20} placeholder="+919876543210" required={b.type === 'PHONE_NUMBER'} onChange={(e) => updateButton(i, { phone: e.target.value })} />
                        </div>
                        {b.type === 'FLOW' && (
                          <div className="col-md-5">
                            <label className="form-label small mb-1" htmlFor={`btn_flow_${i}`}>WhatsApp Flow</label>
                            {flows && flows.length > 0 ? (
                              <select className="form-select form-select-sm" name={`buttons[${i}][flow_id]`} id={`btn_flow_${i}`} value={b.flowId} required onChange={(e) => updateButton(i, { flowId: e.target.value })}>
                                <option value="">Choose a flow…</option>
                                {flows.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status && f.status !== 'PUBLISHED' ? ` (${f.status.toLowerCase()})` : ''}</option>)}
                              </select>
                            ) : (
                              <input type="text" inputMode="numeric" className="form-control form-control-sm" name={`buttons[${i}][flow_id]`} id={`btn_flow_${i}`} value={b.flowId} placeholder="Flow ID, e.g. 1062416823205635" required onChange={(e) => updateButton(i, { flowId: e.target.value.trim() })} />
                            )}
                          </div>
                        )}
                        <div className="col-md-1 text-end">
                          <button type="button" className="btn btn-sm btn-soft-danger btn-remove" title="Remove button" aria-label="Remove button" onClick={() => setButtons((list) => list.filter((x) => x.key !== i))}>
                            <i className="ri-delete-bin-line" />
                          </button>
                        </div>
                        {b.type === 'FLOW' && (
                          <div className="col-12">
                            <div className="row g-2 align-items-end">
                              <div className="col-md-4">
                                <label className="form-label small mb-1" htmlFor={`btn_screen_${i}`}>First screen ID <span className="text-muted">(optional)</span></label>
                                <input type="text" className="form-control form-control-sm" name={`buttons[${i}][navigate_screen]`} id={`btn_screen_${i}`} value={b.screen} maxLength={100} placeholder="e.g. QUESTION_ONE" onChange={(e) => updateButton(i, { screen: e.target.value.trim() })} />
                              </div>
                              <div className="col-md-8 form-text">
                                {flows === null
                                  ? 'Could not load your flows from WhatsApp; enter the Flow ID from WhatsApp Manager → Flows. '
                                  : flows.length === 0 ? 'No flows found on this WhatsApp account. Create one in WhatsApp Manager → Flows first. ' : ''}
                                Replies appear under Incoming → Flow Responses.
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="col-12 btn-example-wrap" hidden={b.type !== 'URL' || !vars(b.url).length}>
                          <label className="form-label small mb-1" htmlFor={`btn_example_${i}`}>Sample full URL</label>
                          <input type="text" className="form-control form-control-sm" name={`buttons[${i}][example]`} id={`btn_example_${i}`} value={b.example} maxLength={2000} placeholder="https://example.com/order/12345" onChange={(e) => updateButton(i, { example: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </fieldset>

          <fieldset id="carousel_fields" disabled={!carousel} hidden={!carousel}>
            <div className="row g-3 mb-3">
              <div className="col-md-4">
                <label htmlFor="card_format" className="form-label">Card Media <span className="text-danger">*</span></label>
                <select className="form-select" name="card_format" id="card_format" value={cardFormat} onChange={(e) => setCardFormat(e.target.value)}>
                  <option value="IMAGE">Image</option>
                  <option value="VIDEO">Video</option>
                </select>
              </div>
              <div className="col-md-4">
                <label htmlFor="card_button_0" className="form-label">Button 1 <span className="text-danger">*</span></label>
                <select className="form-select card-button-type" name="card_buttons[0][type]" id="card_button_0" value={slots[0]} onChange={(e) => setSlots([e.target.value, slots[1]])}>
                  {BUTTON_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label htmlFor="card_button_1" className="form-label">Button 2</label>
                <select className="form-select card-button-type" name="card_buttons[1][type]" id="card_button_1" value={slots[1]} onChange={(e) => setSlots([slots[0], e.target.value])}>
                  <option value="">None</option>
                  {BUTTON_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-12 form-text mt-1">Every card uses the same media type and buttons; each card has its own picture, text and button labels.</div>
            </div>

            <div id="cards">
              {cards.map((card, n) => {
                const c = card.key;
                return (
                  <div className="card-row border rounded p-3 mb-3" key={c}>
                    <div className="d-flex align-items-center mb-2">
                      <span className="fw-semibold me-auto">Card <span className="card-number">{n + 1}</span></span>
                      <button
                        type="button" className="btn btn-sm btn-soft-danger card-remove" title="Remove card" aria-label="Remove card" disabled={cards.length <= 2}
                        onClick={() => setCards((list) => list.filter((x) => x.key !== c))}
                      >
                        <i className="ri-delete-bin-line" />
                      </button>
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-1" htmlFor={`card_file_${c}`}>Sample Media <span className="text-danger">*</span></label>
                      <input
                        type="file" className="form-control form-control-sm card-file" name={`cards[${c}][file]`} id={`card_file_${c}`} required accept={FILE_HINTS[cardFormat][0]}
                        onChange={(e) => updateCard(c, { file: e.target.files?.[0] ?? null })}
                      />
                      <div className="form-text card-file-hint">{FILE_HINTS[cardFormat][1]}</div>
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-1" htmlFor={`card_body_${c}`}>Card Text <span className="text-danger">*</span></label>
                      <textarea
                        ref={(el) => { if (el) cardRefs.current.set(c, el); else cardRefs.current.delete(c); }}
                        className="form-control form-control-sm card-body" name={`cards[${c}][body]`} id={`card_body_${c}`} rows={2} maxLength={160} required
                        value={card.body} onChange={(e) => updateCard(c, { body: e.target.value })}
                      />
                      <div className="d-flex justify-content-between form-text">
                        <span>Up to 160 characters.</span>
                        <button type="button" className="btn btn-link btn-sm p-0 add-variable" onClick={() => addVariable(cardRefs.current.get(c), card.body, (v) => updateCard(c, { body: v }))}>+ Add variable</button>
                      </div>
                    </div>
                    <Examples text={card.body} name={`cards[${c}][body_example]`} values={card.examples} onChange={(v) => updateCard(c, { examples: v })} className="row g-2 mb-2 examples" />

                    {([0, 1] as const).map((s) => {
                      const type = slots[s];
                      const on = !!type;
                      const b = card.buttons[s];
                      const label = BUTTON_TYPES.find(([v]) => v === type)?.[1];
                      return (
                        <div className={`card-slot-${s} row g-2 mb-1`} key={s} hidden={!on}>
                          <div className="col-12 small text-muted slot-label">{on ? `${label} button` : ''}</div>
                          <div className="col-md-4">
                            <input type="text" className="form-control form-control-sm btn-text" name={`cards[${c}][buttons][${s}][text]`} value={b.text} maxLength={25} placeholder="Button text" aria-label={`Button ${s + 1} text`} disabled={!on} required={on} onChange={(e) => updateSlot(card, s, { text: e.target.value })} />
                          </div>
                          <div className="col-md-8 slot-url" hidden={type !== 'URL'}>
                            <input type="text" className="form-control form-control-sm btn-url" name={`cards[${c}][buttons][${s}][url]`} value={b.url} maxLength={2000} placeholder="https://example.com/item/{{1}}" aria-label={`Button ${s + 1} URL`} disabled={!on} required={type === 'URL'} onChange={(e) => updateSlot(card, s, { url: e.target.value })} />
                          </div>
                          <div className="col-md-8 slot-phone" hidden={type !== 'PHONE_NUMBER'}>
                            <input type="text" className="form-control form-control-sm" name={`cards[${c}][buttons][${s}][phone]`} value={b.phone} maxLength={20} placeholder="+919876543210" aria-label={`Button ${s + 1} phone number`} disabled={!on} required={type === 'PHONE_NUMBER'} onChange={(e) => updateSlot(card, s, { phone: e.target.value })} />
                          </div>
                          <div className="col-12 slot-example" hidden={type !== 'URL' || !vars(b.url).length}>
                            <input type="text" className="form-control form-control-sm" name={`cards[${c}][buttons][${s}][example]`} value={b.example} maxLength={2000} placeholder="Sample full URL, e.g. https://example.com/item/123" aria-label={`Button ${s + 1} sample URL`} disabled={!on} onChange={(e) => updateSlot(card, s, { example: e.target.value })} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <button
              type="button" className="btn btn-sm btn-soft-primary mb-3" id="add_card" disabled={cards.length >= 10}
              onClick={() => { if (cards.length < 10) setCards((list) => [...list, newCard(nextKey.current.card++)]); }}
            >
              <i className="ri-add-line" /> Add Card
            </button>
            <span className="form-text ms-2">2 to 10 cards.</span>
          </fieldset>

          <div>
            <SubmitButton className="btn btn-success"><i className="ri-send-plane-2-line" /> Submit for Approval</SubmitButton>{' '}
            <Link href="/templates" className="btn btn-light">Cancel</Link>
          </div>
        </div>

        <div className="col-lg-5">
          <p className="fw-semibold mb-2">Template Sample View</p>
          <div className="wh-card" id="pv_standard" hidden={carousel}>
            <div className="media-wrap" id="pv_header" hidden={headerType === 'NONE'}>
              {headerType === 'TEXT'
                ? <strong>{fill(headerText, { 1: headerExample })}</strong>
                : headerType !== 'NONE' && <MediaPreview type={headerType} file={headerFile} />}
            </div>
            <div className="wh-msg" id="pv_body">{bodyText}</div>
            <div className="wh-footer" id="pv_footer" hidden={!footer}>{footer}</div>
            <div id="pv_buttons">
              {buttons.map((b) => <ButtonPreview key={b.key} type={b.type} text={b.text} />)}
            </div>
          </div>
          <div id="pv_carousel" hidden={!carousel}>
            <div className="wh-card mb-2"><div className="wh-msg" id="pv_bubble">{bodyText}</div></div>
            <div className="wh-carousel" id="pv_cards">
              {cards.map((card) => (
                <div className="wh-card" key={card.key}>
                  <div className="media-wrap"><MediaPreview type={cardFormat} file={card.file} /></div>
                  <div className="wh-msg">{fill(card.body, card.examples) || 'Card text'}</div>
                  {([0, 1] as const).map((s) => slots[s] && <ButtonPreview key={s} type={slots[s]} text={card.buttons[s].text} />)}
                </div>
              ))}
            </div>
          </div>
          <p className="form-text mt-3">WhatsApp reviews new templates, usually within a few minutes and sometimes up to 24 hours. Approved templates appear in your template list.</p>
        </div>
      </div>
    </ActionForm>
  );
}

/** Sample-value inputs for every numbered variable in a text (the .examples rows). */
function Examples({ text, name, values, onChange, className }: {
  text: string;
  name: string;
  values: Record<number, string>;
  onChange: (v: Record<number, string>) => void;
  className: string;
}) {
  return (
    <div className={className}>
      {vars(text).map((n) => {
        const id = name.replace(/\W+/g, '_') + '_' + n;
        return (
          <div className="col-md-4" key={n}>
            <label className="form-label small" htmlFor={id}>Sample for {OPEN + n + CLOSE}</label>
            <input type="text" className="form-control form-control-sm" required id={id} name={`${name}[${n}]`} value={values[n] ?? ''} onChange={(e) => onChange({ ...values, [n]: e.target.value })} />
            <FieldError name={`${name.replace(/\[(\w+)\]/g, '.$1')}.${n}`} />
          </div>
        );
      })}
    </div>
  );
}

function ButtonPreview({ type, text }: { type: string; text: string }) {
  return <div className="wh-action"><i className={ICONS[type]} /><span>{text || 'Button'}</span></div>;
}

/** Picked image shown inline; other media as an icon placeholder. */
function MediaPreview({ type, file }: { type: string; file: File | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (type !== 'IMAGE' || !file) {
      setSrc(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [type, file]);
  if (src) return <img alt="" src={src} />;
  const icon = { IMAGE: 'ri-image-line', VIDEO: 'ri-video-line', DOCUMENT: 'ri-file-pdf-2-line' }[type];
  return (
    <div className="p-3 bg-light rounded text-center">
      <i className={`fs-2 ${icon ?? ''}`} /><br />{type.charAt(0) + type.slice(1).toLowerCase()}
    </div>
  );
}

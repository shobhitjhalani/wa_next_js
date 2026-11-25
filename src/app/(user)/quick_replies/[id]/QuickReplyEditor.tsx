'use client';

import './quick-reply.css';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import {
  fillVars, QR_LIMITS, QR_MATCHES, QR_TYPES, QR_VARS, qrKeywords, sanitizeData, validateReply,
  type QrData, type QrType,
} from '@/lib/quick-reply';
import { waToHtml } from '@/lib/whatsapp-text';
import { saveQuickReply } from '../actions';

interface Initial { name: string; keywords: string; match: number; type: QrType; data: QrData; active: boolean }

/** Editor: keywords + how they match, the reply type and its content, with a live WhatsApp preview. */
export function QuickReplyEditor({ id, initial }: { id: number | null; initial: Initial }) {
  const [name, setName] = useState(initial.name);
  const [keywords, setKeywords] = useState(initial.keywords);
  const [match, setMatch] = useState(initial.match);
  const [type, setType] = useState<QrType>(initial.type);
  const [d, setD] = useState<QrData>(initial.data);
  const [active, setActive] = useState(initial.active);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, startSaving] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Any change clears the messages of the last save attempt
  const touched = () => { setErrors({}); setFormError(''); };
  const set = (patch: Partial<QrData>) => { setD((x) => ({ ...x, ...patch })); touched(); };
  const words = qrKeywords(keywords);

  const save = () => {
    setFormError('');
    const clean = sanitizeData(type, d);
    const problems = validateReply({ name: name.trim(), keywords: words, type, data: clean });
    setErrors(problems);
    if (Object.keys(problems).length) { setFormError('Please fix the highlighted fields.'); return; }
    startSaving(async () => {
      const res = await saveQuickReply(id, { name, keywords, match, type, data: clean, active });
      // Success redirects to the list
      if (res && !res.ok) { setErrors(res.errors ?? {}); setFormError(res.error ?? 'The quick reply could not be saved.'); }
    });
  };

  const insertVar = (v: string) => {
    const el = textRef.current;
    const token = `{{${v}}}`;
    if (!el) { set({ text: d.text + token }); return; }
    const start = el.selectionStart ?? d.text.length;
    const end = el.selectionEnd ?? start;
    set({ text: d.text.slice(0, start) + token + d.text.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const textMax = type === 'text' || type === 'media' ? QR_LIMITS.text : QR_LIMITS.body;
  const err = (k: string) => (errors[k] ? <div className="invalid-feedback d-block">{errors[k]}</div> : null);

  return (
    <div className="row g-4 qr-editor">
      <div className="col-xl-7">
        {formError && <div className="alert alert-danger py-2">{formError}</div>}

        <div className="card">
          <div className="card-header"><h5 className="card-title mb-0"><span className="qr-step">1</span>When a customer sends…</h5></div>
          <div className="card-body">
            <div className="mb-3">
              <label className="form-label" htmlFor="qr_name">Name <span className="text-danger">*</span></label>
              <input id="qr_name" className={`form-control${errors.name ? ' is-invalid' : ''}`} value={name} maxLength={QR_LIMITS.name}
                placeholder="e.g. Price list" onChange={(e) => { setName(e.target.value); touched(); }} />
              <div className="form-text">For you only; customers don&apos;t see it.</div>
              {err('name')}
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="qr_keywords">Keywords <span className="text-danger">*</span></label>
              <textarea id="qr_keywords" className={`form-control${errors.keywords ? ' is-invalid' : ''}`} rows={2} value={keywords}
                placeholder="price, rate, cost" onChange={(e) => { setKeywords(e.target.value); touched(); }} />
              <div className="form-text">Separate keywords with commas. Upper / lower case doesn&apos;t matter.</div>
              {words.length > 0 && <div className="d-flex flex-wrap gap-1 mt-1">{words.map((k) => <span key={k} className="badge bg-primary-subtle text-primary fw-normal">{k}</span>)}</div>}
              {err('keywords')}
            </div>
            <label className="form-label">The message…</label>
            <div className="qr-choices qr-choices-4">
              {QR_MATCHES.map((m) => (
                <button key={m.value} type="button" className={`qr-choice${match === m.value ? ' active' : ''}`} onClick={() => setMatch(m.value)} aria-pressed={match === m.value}>
                  <span className="fw-medium">{m.label}</span>
                  <span className="small text-muted">{m.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h5 className="card-title mb-0"><span className="qr-step">2</span>…reply with</h5></div>
          <div className="card-body">
            <div className="qr-choices qr-choices-4 mb-3">
              {QR_TYPES.map((t) => (
                <button key={t.value} type="button" className={`qr-choice${type === t.value ? ' active' : ''}`} onClick={() => { setType(t.value); touched(); }} aria-pressed={type === t.value}>
                  <span className="fw-medium"><i className={`${t.icon} me-1`} />{t.label}</span>
                  <span className="small text-muted">{t.hint}</span>
                </button>
              ))}
            </div>

            {(type === 'media' || type === 'buttons') && (
              <MediaField value={d.media} onChange={(media) => set({ media })} error={errors.media}
                label={type === 'media' ? 'File *' : 'Media on top (optional)'} buttons={type === 'buttons'} />
            )}

            <div className="mb-3">
              <div className="d-flex align-items-end mb-1">
                <label className="form-label mb-0 me-auto" htmlFor="qr_text">
                  {type === 'media' ? 'Caption (optional)' : 'Message'}{type !== 'media' && <span className="text-danger"> *</span>}
                </label>
                <span className="small text-muted me-1">Insert:</span>
                {QR_VARS.map((v) => <button key={v} type="button" className="btn btn-sm btn-light border py-0 px-2 ms-1" onClick={() => insertVar(v)}>{`{{${v}}}`}</button>)}
              </div>
              <textarea id="qr_text" ref={textRef} className={`form-control${errors.text ? ' is-invalid' : ''}`} rows={5} value={d.text} maxLength={textMax}
                placeholder="Hi {{name}}, here is our price list…" onChange={(e) => set({ text: e.target.value })} />
              <div className="form-text d-flex">
                <span className="me-auto">*bold*, _italic_, ~strike~ work like in WhatsApp. {'{{name}}'} is the customer&apos;s WhatsApp name.</span>
                <span>{d.text.length}/{textMax}</span>
              </div>
              {err('text')}
            </div>

            {type === 'buttons' && (
              <div className="mb-3">
                <label className="form-label">Buttons <span className="text-danger">*</span></label>
                {d.buttons.map((b, i) => (
                  <div className="input-group mb-2" key={i}>
                    <span className="input-group-text"><i className="ri-reply-line" /></span>
                    <input className={`form-control${errors.buttons && !b ? ' is-invalid' : ''}`} value={b} maxLength={QR_LIMITS.button} placeholder={`Button ${i + 1}`}
                      onChange={(e) => set({ buttons: d.buttons.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <span className="input-group-text small text-muted">{b.length}/{QR_LIMITS.button}</span>
                    {d.buttons.length > 1 && (
                      <button type="button" className="btn btn-light border" title="Remove button" aria-label="Remove button"
                        onClick={() => set({ buttons: d.buttons.filter((_, j) => j !== i) })}><i className="ri-close-line" /></button>
                    )}
                  </div>
                ))}
                {d.buttons.length < QR_LIMITS.buttons && (
                  <button type="button" className="btn btn-sm btn-soft-primary" onClick={() => set({ buttons: [...d.buttons, ''] })}><i className="ri-add-line" /> Add button</button>
                )}
                <div className="form-text">Up to 3 buttons. A tapped button is sent back as its title, so a quick reply with that title as keyword can answer it.</div>
                {err('buttons')}
              </div>
            )}

            {type === 'list' && (
              <>
                <div className="mb-3" style={{ maxWidth: 320 }}>
                  <label className="form-label" htmlFor="qr_list_label">Menu button label <span className="text-danger">*</span></label>
                  <input id="qr_list_label" className={`form-control${errors.listLabel ? ' is-invalid' : ''}`} value={d.listLabel} maxLength={QR_LIMITS.listLabel}
                    placeholder="Options" onChange={(e) => set({ listLabel: e.target.value })} />
                  {err('listLabel')}
                </div>
                <div className="mb-3">
                  <label className="form-label">Items <span className="text-danger">*</span></label>
                  {d.rows.map((r, i) => (
                    <div className="qr-row mb-2" key={i}>
                      <span className="qr-row-no">{i + 1}</span>
                      <div className="flex-grow-1">
                        <input className={`form-control form-control-sm mb-1${errors.rows && !r.title ? ' is-invalid' : ''}`} value={r.title} maxLength={QR_LIMITS.rowTitle}
                          placeholder="Title (up to 24 characters)" onChange={(e) => set({ rows: d.rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                        <input className="form-control form-control-sm" value={r.description} maxLength={QR_LIMITS.rowDescription}
                          placeholder="Description (optional)" onChange={(e) => set({ rows: d.rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                      </div>
                      {d.rows.length > 1 && (
                        <button type="button" className="btn btn-sm btn-light border" title="Remove item" aria-label="Remove item"
                          onClick={() => set({ rows: d.rows.filter((_, j) => j !== i) })}><i className="ri-close-line" /></button>
                      )}
                    </div>
                  ))}
                  {d.rows.length < QR_LIMITS.rows && (
                    <button type="button" className="btn btn-sm btn-soft-primary" onClick={() => set({ rows: [...d.rows, { title: '', description: '' }] })}><i className="ri-add-line" /> Add item</button>
                  )}
                  <div className="form-text">Up to 10 items. A chosen item is sent back as its title, so it can open another quick reply.</div>
                  {err('rows')}
                </div>
              </>
            )}

            {(type === 'buttons' || type === 'list') && (
              <div className="mb-1" style={{ maxWidth: 420 }}>
                <label className="form-label" htmlFor="qr_footer">Footer (optional)</label>
                <input id="qr_footer" className="form-control" value={d.footer} maxLength={QR_LIMITS.footer} placeholder="e.g. Reply anytime"
                  onChange={(e) => set({ footer: e.target.value })} />
              </div>
            )}
          </div>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" role="switch" id="qr_active" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <label className="form-check-label" htmlFor="qr_active">{active ? 'On — answers the keywords' : 'Off — saved, does not answer'}</label>
          </div>
          <div className="ms-auto d-flex gap-2">
            <Link href="/quick_replies" className="btn btn-light">Cancel</Link>
            <button type="button" className="btn btn-success" onClick={save} disabled={saving}>
              <i className={saving ? 'ri-loader-4-line' : 'ri-save-3-line'} /> {saving ? 'Saving…' : 'Save Quick Reply'}
            </button>
          </div>
        </div>
      </div>

      <div className="col-xl-5">
        <div className="qr-preview-wrap">
          <div className="small text-muted mb-2"><i className="ri-smartphone-line me-1" />Preview</div>
          <Preview type={type} d={d} keyword={words[0] ?? ''} />
        </div>
      </div>
    </div>
  );
}

/** Upload a file (or paste a link) for media / the media on top of buttons. */
function MediaField({ value, onChange, error, label, buttons }: { value: string; onChange: (v: string) => void; error?: string; label: string; buttons: boolean }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  // Upload a file, or paste the link of a file already online (a saved link that isn't one of our uploads opens on "Paste URL")
  const [mode, setMode] = useState<'upload' | 'url'>(value && !value.includes('/quick_reply/') ? 'url' : 'upload');
  const [link, setLink] = useState(value && !value.includes('/quick_reply/') ? value : '');
  const useLink = () => {
    const v = link.trim();
    setProblem('');
    if (!v) { onChange(''); return; }
    if (!/^https?:\/\/\S+$/i.test(v)) { setProblem('The link must start with https:// and have no spaces.'); return; }
    const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(v.split(/[?#]/)[0])?.[1] ?? '').toLowerCase();
    const allowed = buttons ? ['jpg', 'jpeg', 'png', 'mp4', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']
      : ['jpg', 'jpeg', 'png', 'mp4', '3gp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'mp3', 'ogg', 'aac', 'amr', 'm4a'];
    if (!allowed.includes(ext)) {
      setProblem(`The link must end with the file's type, e.g. .jpg, .png, .mp4 or .pdf${buttons ? '' : ' (or audio .mp3, .ogg)'} — a link to a web page (Google Drive, etc.) doesn't work.`);
      return;
    }
    onChange(v);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem('');
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/quick_replies/upload', { method: 'POST', body, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) onChange(data.url);
      else if (res.status === 413) setProblem('The file is too large for the server.');
      else setProblem(data.message ?? `Upload failed (HTTP ${res.status}). Try again.`);
    } catch {
      setProblem('Upload failed: the connection was interrupted. Try again.');
    }
    setBusy(false);
  };
  const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(value);
  return (
    <div className="mb-3">
      <div className="d-flex align-items-center mb-1">
        <label className="form-label mb-0 me-auto">{label}</label>
        <div className="btn-group btn-group-sm" role="group" aria-label="How to add the file">
          <button type="button" className={`btn ${mode === 'upload' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('upload'); setProblem(''); }}>
            <i className="ri-upload-2-line me-1" />Upload file
          </button>
          <button type="button" className={`btn ${mode === 'url' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('url'); setProblem(''); }}>
            <i className="ri-link me-1" />Paste URL
          </button>
        </div>
      </div>
      {value && (
        <div className="qr-media mb-2">
          {isImage ? <img src={value} alt="" /> : <span className="small text-truncate"><i className="ri-file-line me-1" />{decodeURIComponent(value.split('/').pop() ?? '').replace(/^\d{14}-/, '')}</span>}
          <button type="button" className="btn btn-sm btn-light border ms-auto" onClick={() => { onChange(''); setLink(''); }} title="Remove" aria-label="Remove file"><i className="ri-close-line" /></button>
        </div>
      )}
      {mode === 'url' ? (
        <div className="input-group">
          <input type="url" className={`form-control${error || problem ? ' is-invalid' : ''}`} value={link} placeholder="https://example.com/brochure.pdf"
            onChange={(e) => { setLink(e.target.value); setProblem(''); }} onBlur={useLink}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); useLink(); } }} aria-label="Media URL" />
          <button type="button" className="btn btn-soft-primary" onClick={useLink}>Use link</button>
        </div>
      ) : (
      <div className="d-flex gap-2 align-items-center">
        <input type="file" className={`form-control${error ? ' is-invalid' : ''}`} disabled={busy}
          accept={buttons ? '.jpg,.jpeg,.png,.mp4,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv' : '.jpg,.jpeg,.png,.mp4,.3gp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp3,.ogg,.aac,.amr,.m4a'}
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        {busy && <span className="spinner-border spinner-border-sm text-primary" role="status" aria-label="Uploading" />}
      </div>
      )}
      <div className="form-text">
        Image (JPG, PNG up to 5 MB), video (MP4 up to 16 MB), document (PDF, Word, Excel… up to 95 MB){buttons ? '' : ' or audio (MP3, OGG… up to 16 MB)'}.
        {mode === 'url' && ' A pasted link must open the file itself (publicly, https) and end with its type; WhatsApp downloads it when the reply is sent.'}
      </div>
      {(problem || error) && <div className="invalid-feedback d-block">{problem || error}</div>}
    </div>
  );
}

function Preview({ type, d, keyword }: { type: QrType; d: QrData; keyword: string }) {
  const text = fillVars(d.text, { name: 'Ravi', mobile: '919876543210' });
  const media = type === 'media' || type === 'buttons' ? d.media : '';
  const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(media);
  const isVideo = /\.(mp4|3gp)(\?|$)/i.test(media);
  const empty = !text && !media;
  return (
    <div className="qr-phone">
      <div className="qr-msg qr-in">{keyword || 'keyword'}</div>
      {empty ? <div className="qr-msg qr-out text-muted fst-italic">Your reply appears here</div> : (
        <div className="qr-msg qr-out">
          {media && (isImage ? <img src={media} alt="" className="qr-msg-img" />
            : <div className="qr-msg-file"><i className={isVideo ? 'ri-video-line' : /\.(mp3|ogg|aac|amr|m4a)(\?|$)/i.test(media) ? 'ri-music-2-line' : 'ri-file-text-line'} />
              {decodeURIComponent(media.split('/').pop() ?? '').replace(/^\d{14}-/, '')}</div>)}
          {text && <div dangerouslySetInnerHTML={{ __html: waToHtml(text) }} />}
          {(type === 'buttons' || type === 'list') && d.footer && <div className="qr-msg-footer">{d.footer}</div>}
          {type === 'buttons' && d.buttons.some(Boolean) && (
            <div className="qr-msg-actions">{d.buttons.filter(Boolean).map((b, i) => <span key={i}><i className="ri-reply-line" /> {b}</span>)}</div>
          )}
          {type === 'list' && (
            <>
              <div className="qr-msg-actions"><span><i className="ri-list-unordered" /> {d.listLabel || 'Options'}</span></div>
              {d.rows.some((r) => r.title) && (
                <div className="qr-list">
                  {d.rows.filter((r) => r.title).map((r, i) => (
                    <div key={i}><span className="fw-medium d-block">{r.title}</span>{r.description && <span className="small text-muted">{r.description}</span>}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

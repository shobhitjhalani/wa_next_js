'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SearchSelect } from '@/components/SearchSelect';
import { templateParameterCount } from '@/lib/format';
import { TemplateInputs, TemplatePreview, type ComposeTemplate } from '../compose/TemplateParts';
import type { SendResponse, TemplateListResponse } from './types';

/**
 * "Send Template" popup of the inbox: pick an approved template, fill its
 * values / header media / carousel cards with a live preview, and send it to
 * the open conversation straight away (POST /chat/template).
 */

const URLS = { list: '/chat/template', content: '/templates_content', send: '/chat/template' };

let cachedList: { ut_id: number; ut_name: string }[] | null = null;

export function SendTemplateModal({ mobile, name, onClose, onSent }: {
  mobile: string;
  name: string;
  onClose: () => void;
  onSent: (res: SendResponse) => void;
}) {
  const [list, setList] = useState(cachedList);
  const [listError, setListError] = useState('');
  const [sendWindow, setSendWindow] = useState<TemplateListResponse['window'] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [template, setTemplate] = useState<ComposeTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const request = useRef(0);
  const ucode = useRef('');
  const options = useMemo(() => (list ?? []).map((t) => ({ value: String(t.ut_id), label: t.ut_name })), [list]);

  useEffect(() => {
    document.getElementById('tpl_modal_select')?.focus();
    fetch(URLS.list, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((res: TemplateListResponse) => { cachedList = res.templates; setList(res.templates); setSendWindow(res.window); })
      .catch(() => { if (!cachedList) setListError('Could not load templates.'); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  async function pick(id: string) {
    setTemplateId(id);
    setError('');
    setValues([]);
    const seq = ++request.current;
    if (!id) { setTemplate(null); return; }
    setLoading(true);
    try {
      const res = await fetch(URLS.content, { method: 'POST', body: new URLSearchParams({ id }), credentials: 'same-origin' });
      const data = res.ok ? ((await res.json()) as ComposeTemplate | null) : null;
      if (seq !== request.current) return;
      setTemplate(data);
      if (!data) setError('Could not load this template.');
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!template || sending) return;
    setSending(true);
    setError('');
    // One code per attempt-set: a double click can't send twice, a retry after an error can
    ucode.current ||= 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const data = new FormData(e.currentTarget);
    data.set('mb', mobile);
    data.set('ucode', ucode.current);
    try {
      const r = await fetch(URLS.send, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.message || 'The template could not be sent.');
        if (r.status !== 422 || !/already submitted/i.test(body.message ?? '')) ucode.current = '';
        return;
      }
      onSent(body as SendResponse);
      onClose();
    } catch {
      ucode.current = '';
      setError('Network error — the template could not be sent.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tpl_modal_title" onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">
          <form
            className="modal-content" id="tpl_modal_form" onSubmit={submit} encType="multipart/form-data"
            onInput={(e) => setValues(Array.from(e.currentTarget.querySelectorAll<HTMLInputElement>('input[name="body_parameters[]"]'), (i) => i.value))}
          >
            <div className="modal-header">
              <div className="min-w-0">
                <h5 className="modal-title" id="tpl_modal_title">Send Template</h5>
                <div className="small text-muted text-truncate">To {name}{name !== mobile ? ` · ${mobile}` : ''}</div>
              </div>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={sending} />
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label htmlFor="tpl_modal_select" className="form-label">Template <span className="text-danger">*</span></label>
                  <div className="mb-3">
                    <SearchSelect
                      id="tpl_modal_select" name="temp_id" required value={templateId} onChange={pick} disabled={sending || !list?.length}
                      options={options}
                      placeholder={list ? (list.length ? 'Select Template' : 'No approved templates') : 'Loading…'}
                      searchPlaceholder="Search templates…" emptyText="No templates match"
                    />
                  </div>
                  {listError && <div className="small text-danger mb-2">{listError}</div>}
                  {list && !list.length && <div className="small text-muted mb-2">No approved templates yet — <a href="/templates?sync=1">sync from WhatsApp</a>.</div>}
                  <fieldset disabled={sending}>
                    {template && <TemplateInputs key={template.ut_id} template={template} />}
                  </fieldset>
                  {template && !templateHasInputs(template) && <p className="small text-muted mb-0">This template needs no values.</p>}
                </div>
                <div className="col-md-6">
                  <div className="form-label">Preview</div>
                  <div className="tpl-modal-preview rounded p-2">
                    {loading ? <p className="text-muted small mb-0">Loading…</p>
                      : template ? <TemplatePreview template={filled(template, values)} />
                        : <p className="text-muted small mb-0">Select a template to preview it.</p>}
                  </div>
                </div>
              </div>
            </div>
            {sendWindow && !sendWindow.open && (
              <div className="alert alert-warning small mb-0 mx-3 rounded-2" role="status" id="tpl_modal_window">
                <i className="ri-time-line me-1" />
                Campaign messages are sent between {sendWindow.label}. This template will be queued and go out when the window opens.
              </div>
            )}
            <div className="modal-footer">
              {error && <div className="small text-danger me-auto" role="alert" id="tpl_modal_error">{error}</div>}
              <button type="button" className="btn btn-light" onClick={onClose} disabled={sending}>Cancel</button>
              <button type="submit" className="btn btn-success" id="tpl_modal_send" disabled={!template || sending || loading}>
                <i className="ri-send-plane-2-line" /> {sending ? 'Sending…' : sendWindow && !sendWindow.open ? 'Queue' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

function templateHasInputs(t: ComposeTemplate): boolean {
  return templateParameterCount(t) > 0 || ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.ut_header_type ?? '') || t.ut_template_type === 'carousel';
}

/** The template with typed values in place of {{n}}, for the live preview. */
function filled(t: ComposeTemplate, values: string[]): ComposeTemplate {
  if (!values.some(Boolean)) return t;
  return { ...t, ut_message: (t.ut_message ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n) => values[Number(n) - 1] || all) };
}

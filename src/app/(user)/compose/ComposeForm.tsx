'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionForm, FieldError, useActionForm } from '@/components/ActionForm';
import { SearchSelect } from '@/components/SearchSelect';
import type { ActionResult } from '@/lib/actions';
import { GroupContactsModal } from './GroupContactsModal';
import { TemplateInputs, TemplatePreview, type ComposeTemplate, type FileColumns, type PreviewFill } from './TemplateParts';
import { templateParameterCount } from '@/lib/format';

/**
 * New campaign form: searchable template picker with live preview + parameter inputs;
 * audience in three tabs (contact groups, manual numbers, Excel / CSV upload — they can be
 * combined, each number is sent once); send now / schedule; then a review popup
 * (template, total recipients, send time) whose "Click to Send" submits.
 */

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
interface Group { id: number; name: string; count: number }
type Tab = 'groups' | 'manual' | 'file';
type FileInfo = { state: 'none' } | { state: 'reading'; name: string } | ({ state: 'ok'; name: string; valid: number; invalid: number; duplicates: number } & FileColumns) | { state: 'error'; name: string; message: string };

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * The values entered for the template (parameters, header / card files) for the previews.
 * Attached files get an object URL, reused while the same file stays attached; URLs of
 * files no longer attached are revoked.
 */
function readFill(root: HTMLElement | null, urls: Map<File, string>): PreviewFill {
  const values = (sel: string) => [...(root?.querySelectorAll<HTMLInputElement>(sel) ?? [])].map((i) => i.value);
  const used = new Set<File>();
  const file = (input: HTMLInputElement | null | undefined) => {
    const f = input?.files?.[0];
    if (!f) return null;
    used.add(f);
    if (!urls.has(f)) urls.set(f, URL.createObjectURL(f));
    return { url: urls.get(f)!, name: f.name };
  };
  const cards: PreviewFill['cards'] = [];
  for (let c = 0; root?.querySelector(`[name="cards[${c}][media]"]`); c++) {
    cards.push({ media: file(root.querySelector<HTMLInputElement>(`[name="cards[${c}][media]"]`)), params: values(`[name="cards[${c}][params][]"]`) });
  }
  const fill = { params: values('[name="body_parameters[]"]'), header: file(root?.querySelector<HTMLInputElement>('#img_value')), cards };
  for (const [f, url] of urls) if (!used.has(f)) { URL.revokeObjectURL(url); urls.delete(f); }
  return fill;
}

/** A heading naming a variable: "{{2}}", "2", "Var 2", "variable_2", "Param 2", "Value2" → 2. */
function headingVariable(h: string): number | null {
  const m = /^(?:\{\{)?\s*(?:var(?:iable)?|param(?:eter)?|value|v|p)?\s*[-_#.]?\s*(\d{1,2})\s*(?:\}\})?$/i.exec(h.trim());
  return m ? Number(m[1]) : null;
}

/** Variables a file's headings name ({{n}} ← the column called "{{n}}" / "Var n" …); the others are typed. */
function autoMap(count: number, cols: FileColumns): (number | null)[] {
  return Array.from({ length: count }, (_, k) => {
    const c = cols.headings.findIndex((h, i) => i !== cols.mobileColumn && headingVariable(h) === k + 1);
    return c >= 0 ? c : null;
  });
}

function pastedNumbers(text: string): number {
  return new Set(text.split(/[\n,;]+/).map((s) => s.replace(/\D/g, '')).filter((s) => s.length >= 10)).size;
}

export function ComposeForm({ action, templates, selected, groups, preselectedGroups, mobile, uniqueCode, minSchedule, sendWindow }: {
  action: Action;
  templates: { ut_id: number; ut_name: string }[];
  selected: ComposeTemplate | null;
  groups: Group[];
  preselectedGroups: number[];
  mobile: string;
  uniqueCode: string;
  minSchedule: string;
  sendWindow: string;
}) {
  const [template, setTemplate] = useState<ComposeTemplate | null>(selected);
  const [templateId, setTemplateId] = useState(selected ? String(selected.ut_id) : '');
  const [templateError, setTemplateError] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(preselectedGroups));
  const [numbers, setNumbers] = useState(mobile);
  const [tab, setTab] = useState<Tab>(mobile || !groups.length ? 'manual' : 'groups');
  const [fileInfo, setFileInfo] = useState<FileInfo>({ state: 'none' });
  const [later, setLater] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [noAudience, setNoAudience] = useState(false);
  const [review, setReview] = useState(false);
  const [fill, setFill] = useState<PreviewFill | null>(null);
  // {{n}} → column of the uploaded file (null = typed value)
  const [mapping, setMapping] = useState<(number | null)[]>([]);
  const request = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [groupQuery, setGroupQuery] = useState('');
  const [viewGroup, setViewGroup] = useState<Group | null>(null);
  const closeViewGroup = useCallback(() => setViewGroup(null), []);
  const closeReview = useCallback(() => setReview(false), []);
  const fileUrls = useRef(new Map<File, string>());
  const inputsRef = useRef<HTMLDivElement>(null);
  const refreshFill = useCallback(() => setFill(readFill(inputsRef.current, fileUrls.current)), []);
  // A new template remounts its inputs empty: reset the previews; free all file URLs on leave
  useEffect(() => { refreshFill(); }, [template, refreshFill]);
  useEffect(() => () => { for (const url of fileUrls.current.values()) URL.revokeObjectURL(url); }, []);

  const templateOptions = useMemo(() => templates.map((t) => ({ value: String(t.ut_id), label: t.ut_name })), [templates]);
  const needle = groupQuery.trim().toLowerCase();
  const matchesGroup = (g: Group) => !needle || g.name.toLowerCase().includes(needle);
  const shownGroups = groups.filter(matchesGroup).length;

  const columns: FileColumns | null = fileInfo.state === 'ok' ? fileInfo : null;
  const paramCount = template ? templateParameterCount(template) : 0;
  // A new template or file: map the variables whose heading names them
  useEffect(() => {
    setMapping(columns ? autoMap(paramCount, columns) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, fileInfo]);
  const fromFileVars = !!columns && mapping.some((c) => c !== null);
  // The preview shows the first row's value for a variable taken from the file
  const shownFill = useMemo<PreviewFill | null>(() => {
    if (!fill || !columns || !fromFileVars) return fill;
    return { ...fill, params: fill.params.map((p, i) => (mapping[i] != null ? columns.sample[mapping[i]!] || p : p)) };
  }, [fill, columns, mapping, fromFileVars]);
  const pasted = useMemo(() => pastedNumbers(numbers), [numbers]);
  const fromFile = fileInfo.state === 'ok' ? fileInfo.valid : 0;
  const groupTotal = groups.reduce((sum, g) => sum + (checked.has(g.id) ? g.count : 0), 0);
  const selectedGroups = groups.filter((g) => checked.has(g.id)).length;
  const total = groupTotal + pasted + fromFile;
  const sources = [
    selectedGroups && `${selectedGroups} group${selectedGroups === 1 ? '' : 's'}`,
    pasted && `${fmt(pasted)} typed`,
    fromFile && `${fmt(fromFile)} from file`,
  ].filter(Boolean).join(' + ');
  const estimate = noAudience
    ? 'Choose a group, enter numbers or upload a file'
    : total ? `Up to ${fmt(total)} recipient${total === 1 ? '' : 's'} (${sources})` : 'No recipients selected';
  const fileBusy = fileInfo.state === 'reading';

  async function pickTemplate(id: string) {
    setTemplateId(id);
    setTemplateError(false);
    const seq = ++request.current;
    if (!id) {
      setTemplate(null);
      return;
    }
    const body = new URLSearchParams({ id });
    const res = await fetch('/templates_content', { method: 'POST', body, credentials: 'same-origin' });
    const data = res.ok ? ((await res.json()) as ComposeTemplate | null) : null;
    if (seq === request.current) setTemplate(data);
  }

  async function pickFile(file: File | undefined) {
    setNoAudience(false);
    if (!file) { setFileInfo({ state: 'none' }); return; }
    setFileInfo({ state: 'reading', name: file.name });
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/compose/count_file', { method: 'POST', body, credentials: 'same-origin' });
      const data = await res.json();
      setFileInfo(res.ok ? { state: 'ok', name: file.name, ...data } : { state: 'error', name: file.name, message: data.message ?? 'Could not read the file.' });
    } catch {
      setFileInfo({ state: 'error', name: file.name, message: 'Could not read the file.' });
    }
  }

  function clearFile() {
    if (fileRef.current) fileRef.current.value = '';
    setFileInfo({ state: 'none' });
  }

  /** "Preview & Send": check the form, then show the review popup. */
  function openReview() {
    const form = formRef.current?.closest('form');
    if (!templateId) { setTemplateError(true); document.getElementById('temp_id')?.focus(); return; }
    if (!total) { setNoAudience(true); document.getElementById('audience_card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (fileInfo.state === 'error' || fileBusy) { setTab('file'); return; }
    if (fromFileVars && (selectedGroups || pasted)) { setTab(selectedGroups ? 'groups' : 'manual'); setNoAudience(false); document.getElementById('audience_card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (form && !form.reportValidity()) return; // parameters, header file, schedule time…
    setReview(true);
  }

  const scheduleText = later && scheduleAt
    ? new Date(scheduleAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Now';
  const tabBadge = (n: number) => (n ? <span className="badge bg-primary ms-1">{fmt(n)}</span> : null);

  return (
    <ActionForm action={action} id="campaign_form" onResult={(r) => { if (!r.ok) { setReview(false); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}>
      <input type="hidden" name="ucode" value={uniqueCode} />
      <div className="row g-4" ref={formRef}>
        <div className="col-lg-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><span className="badge bg-primary-subtle text-primary me-1">1</span> Message</h5></div>
            <div className="card-body">
              <div className="mb-3">
                <label htmlFor="campaign_name" className="form-label">Campaign Name <span className="text-muted">(optional)</span></label>
                <input type="text" className="form-control" name="campaign_name" id="campaign_name" maxLength={150} placeholder="e.g. Diwali offer — Jaipur customers" />
                <div className="form-text">Shown on the campaign dashboard. Defaults to the template name and date.</div>
              </div>
              <div className="mb-3">
                <label htmlFor="temp_id" className="form-label">Template <span className="text-danger">*</span></label>
                <SearchSelect
                  id="temp_id" name="temp_id" options={templateOptions} value={templateId} onChange={pickTemplate} required
                  placeholder="Select Template" searchPlaceholder="Search templates…" emptyText="No template matches"
                />
                {templateError && <div className="text-danger small mt-1">Choose a template.</div>}
                <FieldError name="temp_id" />
                {!templates.length && (
                  <div className="form-text text-danger">No templates yet — <a href="/templates?sync=1">sync from WhatsApp</a>.</div>
                )}
              </div>
              <div id="header_div" ref={inputsRef} onInput={refreshFill} onChange={refreshFill}>
                {template && (
                  <TemplateInputs key={template.ut_id} template={template} columns={columns} mapping={mapping}
                    onMap={(i, c) => setMapping((m) => { const n = [...m]; n[i] = c; return n; })} />
                )}
                {template && paramCount > 0 && !columns && (
                  <div className="form-text mt-n2 mb-3"><i className="ri-lightbulb-line me-1" />Different value for each message? Upload an Excel file under Audience → <b>Excel Upload</b> and pick its column for each variable.</div>
                )}
              </div>
            </div>
          </div>

          <div className="card" id="audience_card">
            <div className="card-header d-flex align-items-center flex-wrap gap-2">
              <h5 className="card-title mb-0 me-auto"><span className="badge bg-primary-subtle text-primary me-1">2</span> Audience</h5>
              <span className={`small ${noAudience ? 'text-danger fw-semibold' : 'text-muted'}`} id="audience_estimate">{estimate}</span>
            </div>
            <div className="card-body">
              <ul className="nav nav-tabs mb-3" role="tablist">
                {([['groups', 'ri-group-line', 'Contact Groups', selectedGroups], ['manual', 'ri-keyboard-line', 'Manual Numbers', pasted], ['file', 'ri-file-excel-2-line', 'Excel Upload', fromFile]] as const).map(([key, icon, label, n]) => (
                  <li className="nav-item" role="presentation" key={key}>
                    <button type="button" role="tab" aria-selected={tab === key} className={`nav-link${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                      <i className={`${icon} me-1`} />{label}{tabBadge(n)}
                    </button>
                  </li>
                ))}
              </ul>

              {/* All panels stay in the form (only hidden), so every source is submitted */}
              <div role="tabpanel" hidden={tab !== 'groups'}>
                <div className="d-flex align-items-center mb-1">
                  <span className="form-label mb-0 me-auto">Contact Groups</span>
                  <Link href="/groups" className="small">Manage groups</Link>
                </div>
                {!groups.length ? (
                  <p className="text-muted small mb-0">No groups yet. <Link href="/contacts/upload">Upload contacts</Link> to create one, or use the other tabs.</p>
                ) : (
                  <>
                    {groups.length > 5 && (
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <div className="position-relative flex-grow-1">
                          <i className="ri-search-line position-absolute top-50 translate-middle-y ms-2 text-muted" aria-hidden />
                          <input
                            type="search" className="form-control form-control-sm ps-4" placeholder="Find a group" aria-label="Find a group" value={groupQuery}
                            onChange={(e) => setGroupQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                          />
                        </div>
                        <span className="small text-muted text-nowrap">
                          {groupQuery.trim() ? `${shownGroups} of ${groups.length}` : `${groups.length} groups`}{selectedGroups ? ` · ${selectedGroups} selected` : ''}
                        </span>
                      </div>
                    )}
                    <div className="border rounded p-2 group-picker">
                      {groupQuery.trim() && !shownGroups && <p className="text-muted small mb-0">No group matches “{groupQuery.trim()}”.</p>}
                      {groups.map((g) => (
                        <div className={`form-check align-items-center gap-2 ${matchesGroup(g) ? 'd-flex' : 'd-none'}`} key={g.id}>
                          <input
                            className="form-check-input group-check" type="checkbox" name="groups[]" value={g.id} id={`group_${g.id}`} data-count={g.count}
                            checked={checked.has(g.id)}
                            onChange={(e) => {
                              const next = new Set(checked);
                              if (e.target.checked) next.add(g.id);
                              else next.delete(g.id);
                              setChecked(next);
                              setNoAudience(false);
                            }}
                          />
                          <label className="form-check-label d-flex flex-grow-1" htmlFor={`group_${g.id}`}>
                            <span className="me-auto">{g.name}</span>
                            <span className="text-muted small">{fmt(g.count)}</span>
                          </label>
                          <button type="button" className="btn btn-link btn-sm p-0 text-info" title="View contacts" aria-label={`View contacts in ${g.name}`} onClick={() => setViewGroup(g)}>
                            <i className="ri-eye-line" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {viewGroup && <GroupContactsModal groupId={viewGroup.id} name={viewGroup.name} onClose={closeViewGroup} />}
              </div>

              <div role="tabpanel" hidden={tab !== 'manual'}>
                <label htmlFor="txt_contact" className="form-label">Mobile Numbers <span className="text-muted">(one per line or comma separated)</span></label>
                <textarea name="txt_contact" id="txt_contact" className="form-control" rows={6} value={numbers} placeholder={'9876543210\n919812345678'} onChange={(e) => { setNumbers(e.target.value); setNoAudience(false); }} />
                <div className="form-text"><span id="contact_count">{fmt(pasted)}</span> unique number(s).</div>
              </div>

              <div role="tabpanel" hidden={tab !== 'file'}>
                <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
                  <label htmlFor="contact_file" className="form-label mb-0 me-auto">Excel / CSV File</label>
                  <a href="/compose/sample" className="btn btn-sm btn-soft-primary" download><i className="ri-file-excel-2-line" /> Download sample Excel</a>
                  <a href="/contacts/sample" className="btn btn-sm btn-light border" download><i className="ri-download-2-line" /> Sample CSV</a>
                </div>
                <div className="d-flex gap-2 align-items-center">
                  <input
                    ref={fileRef} type="file" className="form-control" name="contact_file" id="contact_file"
                    accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                  {fileInfo.state !== 'none' && <button type="button" className="btn btn-light border" onClick={clearFile} title="Remove file" aria-label="Remove file"><i className="ri-close-line" /></button>}
                </div>
                <div className="form-text">
                  .xlsx, .csv or .txt, up to 10 MB. The mobile number column is found from a header such as “Mobile” or “Phone”, or the first column with numbers.
                </div>
                {fileInfo.state === 'reading' && <div className="small text-muted mt-2"><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden />Reading {fileInfo.name}…</div>}
                {fileInfo.state === 'error' && <div className="small text-danger mt-2">{fileInfo.message}</div>}
                {fileInfo.state === 'ok' && (
                  <div className="small mt-2">
                    <span className="text-success fw-semibold">{fmt(fileInfo.valid)} valid number{fileInfo.valid === 1 ? '' : 's'}</span>
                    {fileInfo.invalid > 0 && <span className="text-danger"> · {fmt(fileInfo.invalid)} invalid (skipped)</span>}
                    {fileInfo.duplicates > 0 && <span className="text-muted"> · {fmt(fileInfo.duplicates)} duplicate(s)</span>}
                  </div>
                )}
                <FieldError name="contact_file" />
              </div>

              {fromFileVars && (selectedGroups > 0 || pasted > 0) && (
                <div className="alert alert-warning small py-2 mt-3 mb-0">
                  <i className="ri-error-warning-line me-1" />Variables come from the Excel file, so the campaign goes to the file&apos;s numbers only.
                  Untick the contact groups and clear the typed numbers{' '}
                  <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => { setChecked(new Set()); setNumbers(''); }}>(clear them)</button>.
                </div>
              )}
              <div className="form-text mt-3 mb-0">{fromFileVars
                ? 'Each number in the file gets the values of its own row. Opted-out contacts are skipped automatically.'
                : 'You can combine the tabs. Numbers in more than one source are sent once; opted-out contacts are skipped automatically.'}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0"><span className="badge bg-primary-subtle text-primary me-1">3</span> Schedule</h5></div>
            <div className="card-body">
              <div className="d-flex flex-wrap gap-3 mb-2">
                <div className="form-check">
                  <input className="form-check-input" type="radio" name="send_mode" id="send_now" value="now" checked={!later} onChange={() => setLater(false)} />
                  <label className="form-check-label" htmlFor="send_now">Send now</label>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="radio" name="send_mode" id="send_later" value="later" checked={later} onChange={() => setLater(true)} />
                  <label className="form-check-label" htmlFor="send_later">Schedule for later</label>
                </div>
              </div>
              <div id="schedule_wrap" hidden={!later}>
                <label htmlFor="schedule_at" className="form-label">Send At</label>
                <input
                  type="datetime-local" className="form-control" name="schedule_at" id="schedule_at" min={minSchedule} required={later} style={{ maxWidth: 280 }}
                  value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                />
                <FieldError name="schedule_at" />
              </div>
              <div className="form-text">Messages go out between {sendWindow}; anything queued outside those hours waits for the next window.</div>
            </div>
          </div>

          <button type="button" className="btn btn-success btn-lg mb-4" id="review_btn" onClick={openReview} disabled={fileBusy}>
            <i className="ri-eye-line" /> Preview &amp; Send
          </button>
        </div>

        <div className="col-lg-5">
          <div className="card sticky-lg-top" style={{ top: 90 }}>
            <div className="card-header"><h5 className="card-title mb-0">Template Preview</h5></div>
            <div className="card-body" id="template_content">
              {template ? <TemplatePreview template={template} fill={shownFill ?? undefined} /> : <p className="text-muted mb-0">Select a template to preview it.</p>}
              {template && fromFileVars && <div className="small text-muted mt-2"><i className="ri-table-line me-1" />Shown with the first row of your file.</div>}
            </div>
            <ul className="list-group list-group-flush small">
              <li className="list-group-item d-flex"><span className="text-muted me-auto">Total data</span><strong>{fmt(total)}</strong></li>
              <li className="list-group-item d-flex"><span className="text-muted me-auto">Schedule</span><strong>{later ? (scheduleAt ? scheduleText : 'Choose a time') : 'Send now'}</strong></li>
            </ul>
          </div>
        </div>
      </div>

      {review && (
        <ReviewModal
          onClose={closeReview} template={template} fill={shownFill} templateName={templateOptions.find((o) => o.value === templateId)?.label ?? ''}
          total={total} sources={sources} schedule={later ? scheduleText : 'Now'} later={later}
        />
      )}
    </ActionForm>
  );
}

/** Review popup: template, total data and send time; "Click to Send" submits the campaign form. */
function ReviewModal({ onClose, template, fill, templateName, total, sources, schedule, later }: {
  onClose: () => void; template: ComposeTemplate | null; fill: PreviewFill | null; templateName: string; total: number; sources: string; schedule: string; later: boolean;
}) {
  const { pending } = useActionForm();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose, pending]);

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="review_title" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}>
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg modal-fullscreen-sm-down">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id="review_title">Review Campaign</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={pending} />
            </div>
            <div className="modal-body">
              <div className="row g-4">
                <div className="col-md-6">
                  <p className="text-muted small text-uppercase mb-2">Template</p>
                  <div className="tpl-view-body rounded p-3">{template ? <TemplatePreview template={template} fill={fill ?? undefined} /> : <p className="mb-0">{templateName}</p>}</div>
                </div>
                <div className="col-md-6">
                  <dl className="mb-0">
                    <dt className="text-muted small text-uppercase fw-normal">Template</dt>
                    <dd className="fs-6 fw-semibold mb-3">{templateName}</dd>
                    <dt className="text-muted small text-uppercase fw-normal">Total data</dt>
                    <dd className="mb-3"><span className="fs-3 fw-semibold">{total.toLocaleString('en-US')}</span><div className="small text-muted">{sources}</div>
                      <div className="small text-muted">Up to this many; duplicates and opted-out contacts are skipped.</div></dd>
                    <dt className="text-muted small text-uppercase fw-normal">Schedule time</dt>
                    <dd className="fs-6 fw-semibold mb-0">{schedule}</dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-light" onClick={onClose} disabled={pending}>Back</button>
              <button type="submit" className="btn btn-success btn-lg" id="submit_btn" disabled={pending}>
                <i className="ri-send-plane-2-line" /> {pending ? 'Sending…' : later ? 'Click to Schedule' : 'Click to Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

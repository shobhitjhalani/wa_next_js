'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { ActionForm, useActionForm } from '@/components/ActionForm';
import type { ActionResult } from '@/lib/actions';
import { TemplateInputs, TemplatePreview, type ComposeTemplate } from './TemplateParts';

/**
 * New campaign form (compose.blade.php and its jQuery): template picker with
 * live preview + parameter inputs, groups, pasted numbers with a recipient
 * estimate, send now / schedule.
 */

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
interface Group { id: number; name: string; count: number }

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
  const [checked, setChecked] = useState<Set<number>>(() => new Set(preselectedGroups));
  const [numbers, setNumbers] = useState(mobile);
  const [later, setLater] = useState(false);
  const [noAudience, setNoAudience] = useState(false);
  const request = useRef(0);

  const pasted = useMemo(() => pastedNumbers(numbers), [numbers]);
  const groupTotal = groups.reduce((sum, g) => sum + (checked.has(g.id) ? g.count : 0), 0);
  const selectedGroups = groups.filter((g) => checked.has(g.id)).length;
  const total = groupTotal + pasted;
  const estimate = noAudience
    ? 'Choose a group or enter numbers'
    : total
      ? `Up to ${total.toLocaleString('en-US')} recipient${total === 1 ? '' : 's'}${selectedGroups ? ` from ${selectedGroups} group${selectedGroups === 1 ? '' : 's'}${pasted ? ' + pasted numbers' : ''}` : ''}`
      : 'No recipients selected';

  async function pickTemplate(id: string) {
    setTemplateId(id);
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

  return (
    <ActionForm action={action} id="campaign_form">
      <input type="hidden" name="ucode" value={uniqueCode} />
      <div className="row g-4">
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
                <select className="form-select" name="temp_id" id="temp_id" required value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                  {templates.length !== 1 && <option value="">Select Template</option>}
                  {templates.map((t) => <option key={t.ut_id} value={t.ut_id}>{t.ut_name}</option>)}
                </select>
                {!templates.length && (
                  <div className="form-text text-danger">No templates yet — <a href="/templates?sync=1">sync from WhatsApp</a>.</div>
                )}
              </div>
              <div id="header_div">
                {template && <TemplateInputs key={template.ut_id} template={template} />}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header d-flex align-items-center">
              <h5 className="card-title mb-0 me-auto"><span className="badge bg-primary-subtle text-primary me-1">2</span> Audience</h5>
              <span className={`text-muted small${noAudience ? ' text-danger' : ''}`} id="audience_estimate">{estimate}</span>
            </div>
            <div className="card-body">
              <div className="mb-3">
                <div className="d-flex align-items-center mb-1">
                  <span className="form-label mb-0 me-auto">Contact Groups</span>
                  <Link href="/groups" className="small">Manage groups</Link>
                </div>
                {!groups.length ? (
                  <p className="text-muted small mb-0">No groups yet. <Link href="/contacts/upload">Upload contacts</Link> to create one, or paste numbers below.</p>
                ) : (
                  <div className="border rounded p-2 group-picker">
                    {groups.map((g) => (
                      <div className="form-check" key={g.id}>
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
                        <label className="form-check-label d-flex" htmlFor={`group_${g.id}`}>
                          <span className="me-auto">{g.name}</span>
                          <span className="text-muted small">{g.count.toLocaleString('en-US')}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="txt_contact" className="form-label">Additional Numbers <span className="text-muted">(one per line or comma separated)</span></label>
                <textarea name="txt_contact" id="txt_contact" className="form-control" rows={5} value={numbers} onChange={(e) => { setNumbers(e.target.value); setNoAudience(false); }} />
                <div className="form-text"><span id="contact_count">{pasted}</span> unique number(s). Numbers in both a group and this list are sent once; opted-out contacts are skipped automatically.</div>
              </div>
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
                <input type="datetime-local" className="form-control" name="schedule_at" id="schedule_at" min={minSchedule} required={later} style={{ maxWidth: 280 }} />
              </div>
              <div className="form-text">Messages go out between {sendWindow}; anything queued outside those hours waits for the next window.</div>
            </div>
          </div>

          <SendButton later={later} onBlocked={() => setNoAudience(true)} canSend={selectedGroups > 0 || pasted > 0} />
        </div>

        <div className="col-lg-5">
          <div className="card sticky-lg-top" style={{ top: 90 }}>
            <div className="card-header"><h5 className="card-title mb-0">Template Preview</h5></div>
            <div className="card-body" id="template_content">
              {template ? <TemplatePreview template={template} /> : <p className="text-muted mb-0">Select a template to preview it.</p>}
            </div>
          </div>
        </div>
      </div>
    </ActionForm>
  );
}

/** Submit button: blocks submitting with no audience and shows "Working…" while the action runs. */
function SendButton({ later, canSend, onBlocked }: { later: boolean; canSend: boolean; onBlocked: () => void }) {
  const { pending } = useActionForm();
  return (
    <button
      type="submit" className="btn btn-success btn-lg mb-4" id="submit_btn" disabled={pending}
      onClick={(e) => {
        if (!canSend) {
          e.preventDefault();
          onBlocked();
        }
      }}
    >
      <i className="ri-send-plane-2-line" /> <span>{pending ? 'Working…' : later ? 'Schedule Campaign' : 'Send Campaign'}</span>
    </button>
  );
}

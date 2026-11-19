'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { modal } from '@/components/ui';
import { FOLLOWUP_TYPES, LEAD_STATUS, OPEN_STATUSES, STATUS_INFO } from '@/lib/crm';
import { addFollowup, saveLeadAction } from './actions';

export interface LeadFormValues {
  ld_id: number; ld_name: string; ld_mobile: string; ld_email: string; ld_source: string; ld_campaign: string; ld_notes: string;
}

/** "2026-11-21T10:00" in the browser's time for a datetime-local input. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const QUICK: { label: string; at: () => Date }[] = [
  { label: 'In 2 hours', at: () => { const d = new Date(Date.now() + 2 * 3600_000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d; } },
  { label: 'Tomorrow', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; } },
  { label: 'In 3 days', at: () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(10, 0, 0, 0); return d; } },
  { label: 'Next week', at: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(10, 0, 0, 0); return d; } },
];

/** Date + time input for the next follow-up with quick picks (Tomorrow 10 AM …). */
function NextFollowup({ disabled = false, help }: { disabled?: boolean; help?: string }) {
  const [value, setValue] = useState('');
  return (
    <div>
      <label className="form-label" htmlFor="next_followup">Next follow-up</label>
      <input type="datetime-local" className="form-control" id="next_followup" name="next_followup" value={disabled ? '' : value}
        disabled={disabled} min={localInput(new Date())} onChange={(e) => setValue(e.target.value)} />
      <div className="d-flex flex-wrap gap-1 mt-1">
        {QUICK.map((q) => (
          <button key={q.label} type="button" className="btn btn-sm btn-light border" disabled={disabled} onClick={() => setValue(localInput(q.at()))}>{q.label}</button>
        ))}
        {value && !disabled && <button type="button" className="btn btn-sm btn-link text-muted" onClick={() => setValue('')}>Clear</button>}
      </div>
      <FieldError name="next_followup" />
      {help && <div className="form-text">{help}</div>}
    </div>
  );
}

/** "Add Lead" / "Edit" modal. */
export function LeadModal({ id, lead, sources }: { id: string; lead?: LeadFormValues; sources: { value: string; label: string }[] }) {
  const edit = !!lead;
  const router = useRouter();
  return (
    <div className="modal fade" id={id} tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content">
          <ActionForm action={saveLeadAction} onResult={(r) => {
            if (!r.ok) return;
            modal(id, 'hide');
            const newId = (r.data as { id?: number } | undefined)?.id;
            if (newId) {
              // Wait for Bootstrap to remove the backdrop, then open the new lead
              document.getElementById(id)?.addEventListener('hidden.bs.modal', () => router.push(`/crm/${newId}`), { once: true });
            }
          }}>
            <div className="modal-header">
              <h5 className="modal-title">{edit ? 'Edit lead' : 'Add lead'}</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close" />
            </div>
            <div className="modal-body">
              <input type="hidden" name="ld_id" value={lead?.ld_id ?? 0} />
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-name`}>Name</label>
                  <input className="form-control" id={`${id}-name`} name="name" defaultValue={lead?.ld_name} maxLength={120} autoFocus />
                  <FieldError name="name" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-mobile`}>Mobile</label>
                  <input className="form-control" id={`${id}-mobile`} name="mobile" defaultValue={lead?.ld_mobile} inputMode="tel" placeholder="9876543210 or +44 7911 123456" />
                  <FieldError name="mobile" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-email`}>Email</label>
                  <input type="email" className="form-control" id={`${id}-email`} name="email" defaultValue={lead?.ld_email} />
                  <FieldError name="email" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-source`}>Source</label>
                  <select className="form-select" id={`${id}-source`} name="source" defaultValue={lead?.ld_source ?? 'facebook'}>
                    {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    {lead && !sources.some((s) => s.value === lead.ld_source) && <option value={lead.ld_source}>{lead.ld_source}</option>}
                  </select>
                  <FieldError name="source" />
                </div>
                <div className="col-12">
                  <label className="form-label" htmlFor={`${id}-campaign`}>Campaign / ad / form</label>
                  <input className="form-control" id={`${id}-campaign`} name="campaign" defaultValue={lead?.ld_campaign} maxLength={200} placeholder="e.g. Nexon EV — November offer" />
                </div>
                <div className="col-12">
                  <label className="form-label" htmlFor={`${id}-notes`}>Notes / requirement</label>
                  <textarea className="form-control" id={`${id}-notes`} name="notes" rows={3} defaultValue={lead?.ld_notes} maxLength={4000} />
                </div>
                {!edit && <div className="col-md-8"><NextFollowup help="You get a reminder at this time." /></div>}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-light" data-bs-dismiss="modal">Cancel</button>
              <SubmitButton className="btn btn-success" pendingText="Saving…">{edit ? 'Save changes' : 'Add lead'}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}

/** "Add follow-up": what happened, new status, next follow-up. */
export function FollowupForm({ leadId, status }: { leadId: number; status: number }) {
  // After the first contact a New lead is usually Contacted
  const [next, setNext] = useState(status === LEAD_STATUS.NEW ? LEAD_STATUS.CONTACTED : status);
  const [key, setKey] = useState(0);
  const closed = !(OPEN_STATUSES as readonly number[]).includes(next);
  return (
    <ActionForm key={key} action={addFollowup} onResult={(r) => { if (r.ok) setTimeout(() => setKey((k) => k + 1), 2500); }}>
      <input type="hidden" name="ld_id" value={leadId} />
      <div className="mb-3">
        <div className="d-flex flex-wrap gap-2">
          {FOLLOWUP_TYPES.map((t, i) => (
            <div key={t.value}>
              <input type="radio" className="btn-check" name="type" id={`fu-type-${t.value}`} value={t.value} defaultChecked={i === 0} />
              <label className="btn btn-sm btn-outline-secondary" htmlFor={`fu-type-${t.value}`}><i className={`${t.icon} me-1`} />{t.label}</label>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="fu-note">What happened?</label>
        <textarea className="form-control" id="fu-note" name="note" rows={3} maxLength={4000} placeholder="e.g. Called, interested in the EV, wants a test drive on Saturday" />
        <FieldError name="note" />
      </div>
      <div className="row g-3">
        <div className="col-md-4">
          <label className="form-label" htmlFor="fu-status">Status</label>
          <select className="form-select" id="fu-status" name="status" value={next} onChange={(e) => setNext(Number(e.target.value))}>
            {Object.entries(STATUS_INFO).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>
          <FieldError name="status" />
        </div>
        <div className="col-md-8">
          <NextFollowup disabled={closed} help={closed ? 'Won and Lost leads need no more follow-ups.' : 'Leave empty if no further follow-up is needed.'} />
        </div>
      </div>
      <div className="mt-3 text-end">
        <SubmitButton className="btn btn-success" pendingText="Saving…"><i className="ri-save-line me-1" />Save follow-up</SubmitButton>
      </div>
    </ActionForm>
  );
}

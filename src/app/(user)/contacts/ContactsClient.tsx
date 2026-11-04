'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ActionForm, FieldError, FormAlert } from '@/components/ActionForm';
import { modal } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';
import type { ImportResult } from '@/lib/services/contacts-import';

/** Client parts of the contact list (the Blade page's inline jQuery). */

interface Group { ug_id: number; up_group_name: string }

/**
 * The bulk form around the contact table: selection count, "select all N
 * matching", action + group pickers and the confirm prompts.
 */
export function BulkForm({ action, total, pageCount, groups, currentGroup, children }: {
  action: (fd: FormData) => Promise<void>;
  total: number;
  pageCount: number;
  groups: Group[];
  currentGroup: number | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [n, setN] = useState(0);
  const [all, setAll] = useState(false);
  const [bulkAction, setBulkAction] = useState('');
  const totalText = total.toLocaleString('en-US');

  const pageSelected = pageCount > 0 && n === pageCount;
  useEffect(() => {
    const page = ref.current?.querySelector<HTMLInputElement>('#check_page');
    if (page) page.checked = pageSelected;
  }, [pageSelected]);

  const needsGroup = bulkAction === 'add_group' || bulkAction === 'remove_group';

  // Native listeners: React's onChange misses a checkbox ticked again after the
  // automatic form reset that follows the action (its value tracker is stale).
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const count = () => form.querySelectorAll('.row-check:checked').length;
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'check_page') form.querySelectorAll<HTMLInputElement>('.row-check').forEach((c) => { c.checked = t.checked; });
      else if (!t.classList.contains('row-check')) return;
      setAll(false);
      setN(count());
    };
    const onReset = () => { setN(0); setAll(false); setBulkAction(''); };
    form.addEventListener('change', onChange);
    form.addEventListener('reset', onReset);
    return () => {
      form.removeEventListener('change', onChange);
      form.removeEventListener('reset', onReset);
    };
  }, []);

  return (
    <form
      ref={ref}
      action={action}
      id="bulk_form"
      onSubmit={(e) => {
        if (bulkAction === 'delete' && !window.confirm('Delete the selected contacts? Contacts with chat history stay in the Inbox but leave all groups.')) e.preventDefault();
        if (bulkAction === 'opt_out' && !window.confirm('Opt out the selected contacts? Campaigns will skip them.')) e.preventDefault();
      }}
    >
      <input type="hidden" name="all" value={all ? '1' : '0'} id="bulk_all" readOnly />
      <div className="card-body pb-0">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span className="text-muted small me-auto">
            {totalText} contact(s)
            {currentGroup !== null && (
              <> · <Link href={`/compose?group=${currentGroup}`}><i className="ri-megaphone-line" /> Send a campaign to this group</Link></>
            )}
          </span>
          <div className="d-flex flex-wrap gap-2 align-items-center" id="bulk_bar" hidden={!n && !all}>
            <span className="small fw-medium" id="bulk_count">{all ? `All ${totalText} selected` : `${n} selected`}</span>
            <select className="form-select form-select-sm w-auto" name="action" id="bulk_action" aria-label="Bulk action" required
              value={bulkAction} onChange={(e) => setBulkAction(e.target.value)}>
              <option value="">Choose action…</option>
              <option value="add_group">Add to group</option>
              <option value="remove_group">Remove from group</option>
              <option value="opt_out">Opt out</option>
              <option value="opt_in">Opt back in</option>
              <option value="delete">Delete</option>
            </select>
            <select className="form-select form-select-sm w-auto" name="group_id" id="bulk_group" aria-label="Group" hidden={!needsGroup} disabled={!needsGroup}
              defaultValue={currentGroup ?? undefined}>
              {groups.map((g) => <option key={g.ug_id} value={g.ug_id}>{g.up_group_name}</option>)}
            </select>
            <button type="submit" className="btn btn-sm btn-primary">Apply</button>
          </div>
        </div>
        <div className="alert alert-light border py-2 small" id="select_all_note" hidden={!pageSelected || all}>
          All {pageCount} contacts on this page are selected.
          {total > pageCount && (
            <> <button type="button" className="btn btn-link btn-sm p-0 align-baseline" id="select_all_matching" onClick={() => setAll(true)}>Select all {totalText} matching contacts</button></>
          )}
        </div>
      </div>
      {children}
    </form>
  );
}

export interface EditableContact {
  id: number;
  name: string | null;
  mobile: string | null;
  groups: number[];
  opted_out: boolean;
  locked: boolean;
}

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/** Add / edit modal; opened by buttons with data-bs-target="#contact_modal" data-mode (and data-contact JSON). */
export function ContactModal({ groups, currentGroup, countryCode, store, update }: {
  groups: Group[];
  currentGroup: number | null;
  countryCode: string;
  store: Action;
  update: Action;
}) {
  const [open, setOpen] = useState<{ n: number; c: EditableContact | null }>({ n: 0, c: null });
  useEffect(() => {
    const el = document.getElementById('contact_modal');
    if (!el) return;
    const onShow = (e: Event) => {
      const btn = (e as Event & { relatedTarget?: HTMLElement }).relatedTarget;
      const c = btn?.dataset.mode === 'edit' && btn.dataset.contact ? (JSON.parse(btn.dataset.contact) as EditableContact) : null;
      setOpen((o) => ({ n: o.n + 1, c }));
    };
    el.addEventListener('show.bs.modal', onShow);
    return () => el.removeEventListener('show.bs.modal', onShow);
  }, []);

  const c = open.c;
  const hint = `10-digit numbers are saved without the +${countryCode} country code.`;
  return (
    <div className="modal fade" id="contact_modal" tabIndex={-1} aria-labelledby="contact_modal_title" aria-hidden="true">
      <div className="modal-dialog">
        <ActionForm key={open.n} action={c ? update : store} className="modal-content" id="contact_form" showAlert={false}
          onResult={(r) => { if (r.ok) modal('contact_modal', 'hide'); }}>
          {c && <input type="hidden" name="id" value={c.id} />}
          <div className="modal-header">
            <h5 className="modal-title" id="contact_modal_title">{c ? 'Edit Contact' : 'Add Contact'}</h5>
            <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body">
            <FormAlert />
            <div className="mb-3">
              <label htmlFor="contact_mobile" className="form-label">Mobile Number <span className="text-danger">*</span></label>
              <input type="text" className="form-control" name="mobile" id="contact_mobile" required inputMode="tel" placeholder="9876543210 or +971501234567"
                defaultValue={c?.mobile ?? ''} readOnly={!!c?.locked} />
              <div className="form-text" id="contact_mobile_hint">{c?.locked ? 'This number has chat history, so it cannot be changed.' : hint}</div>
              <FieldError name="mobile" />
            </div>
            <div className="mb-3">
              <label htmlFor="contact_name" className="form-label">Name</label>
              <input type="text" className="form-control" name="name" id="contact_name" maxLength={250} defaultValue={c?.name ?? ''} />
              <FieldError name="name" />
            </div>
            <div className="mb-3">
              <span className="form-label d-block">Groups</span>
              {groups.length === 0 ? (
                <p className="small text-muted mb-0">No groups yet — <Link href="/groups">create one</Link>.</p>
              ) : (
                <div className="border rounded p-2 group-picker">
                  {groups.map((g) => (
                    <div className="form-check" key={g.ug_id}>
                      <input className="form-check-input contact-group" type="checkbox" name="groups[]" value={g.ug_id} id={`contact_group_${g.ug_id}`}
                        defaultChecked={c ? c.groups.includes(g.ug_id) : currentGroup === g.ug_id} />
                      <label className="form-check-label" htmlFor={`contact_group_${g.ug_id}`}>{g.up_group_name}</label>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" role="switch" name="opted_out" value="1" id="contact_opted_out" defaultChecked={!!c?.opted_out} />
              <label className="form-check-label" htmlFor="contact_opted_out">Opted out — never include in campaigns</label>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-light" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" className="btn btn-success">Save</button>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}

export type ImportSummaryData = ImportResult & { group: string | null };

/** "Upload complete" box after an import (Laravel session('import')); shown once. */
export function ImportSummary({ data }: { data: ImportSummaryData }) {
  useEffect(() => {
    document.cookie = 'wa_import=; Max-Age=0; path=/';
  }, []);
  const nf = (v: number) => v.toLocaleString('en-US');
  return (
    <div className="alert alert-success" role="status">
      <h6 className="alert-heading mb-2"><i className="ri-upload-cloud-2-line" /> Upload complete{data.group ? ` — group “${data.group}”` : ''}</h6>
      <div className="d-flex flex-wrap gap-4 small">
        <span><strong>{nf(data.rows)}</strong> rows read</span>
        <span><strong>{nf(data.created)}</strong> new contacts</span>
        <span><strong>{nf(data.updated)}</strong> names updated</span>
        <span><strong>{nf(data.unchanged)}</strong> already saved</span>
        {data.group && <span><strong>{nf(data.grouped)}</strong> added to the group</span>}
        {data.duplicates > 0 && <span><strong>{nf(data.duplicates)}</strong> duplicates in file</span>}
        {data.invalid > 0 && <span className="text-danger"><strong>{nf(data.invalid)}</strong> invalid numbers skipped</span>}
      </div>
      {data.invalid_samples.length > 0 && (
        <div className="small text-muted mt-2">Examples of skipped values: {data.invalid_samples.join(', ')}</div>
      )}
    </div>
  );
}

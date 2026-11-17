'use client';

import { useRef, useState } from 'react';
import { ActionForm, FieldError, useActionForm } from '@/components/ActionForm';
import type { ActionResult } from '@/lib/actions';

interface Group { ug_id: number; up_group_name: string }

function UploadButton({ manual }: { manual: boolean }) {
  const { pending } = useActionForm();
  if (manual) {
    return (
      <button type="submit" className="btn btn-success" id="upload_btn" disabled={pending}>
        <i className="ri-user-add-line" /> <span>{pending ? 'Saving…' : 'Save Contacts'}</span>
      </button>
    );
  }
  return (
    <button type="submit" className="btn btn-success" id="upload_btn" disabled={pending}>
      <i className="ri-upload-cloud-2-line" /> <span>{pending ? 'Uploading… large files can take a minute' : 'Upload Contacts'}</span>
    </button>
  );
}

/** Mobile + name rows typed in by hand (posted as m_mobile / m_name, in order). */
function ManualRows() {
  const next = useRef(1);
  const [rows, setRows] = useState<number[]>([0]);
  const add = () => setRows((r) => [...r, next.current++]);
  return (
    <div className="mb-4">
      <span className="form-label d-block">Contacts <span className="text-danger">*</span></span>
      {rows.map((key, i) => (
        <div className="row g-2 mb-2" key={key}>
          <div className="col-5">
            <input
              type="tel" className="form-control" name="m_mobile" placeholder="Mobile, e.g. 9876543210" aria-label={`Mobile ${i + 1}`}
              required={i === 0} autoFocus={i > 0 && i === rows.length - 1}
              onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); add(); } }}
            />
          </div>
          <div className="col">
            <input
              type="text" className="form-control" name="m_name" maxLength={250} placeholder="Name (optional)" aria-label={`Name ${i + 1}`}
              onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); add(); } }}
            />
          </div>
          <div className="col-auto">
            <button
              type="button" className="btn btn-soft-danger" title="Remove" aria-label={`Remove row ${i + 1}`}
              disabled={rows.length === 1} onClick={() => setRows((r) => r.filter((k) => k !== key))}
            >
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-soft-primary" onClick={add} disabled={rows.length >= 500}>
        <i className="ri-add-line" /> Add another contact
      </button>
      <div className="form-text">With country code for numbers outside India (e.g. +971501234567). Press Enter in the last row to add a new one.</div>
      <FieldError name="m_mobile" />
    </div>
  );
}

/** The upload form with the new / existing / no group choice. */
export function UploadForm({ action, groups, selectedGroup, initialSource = 'file' }: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  groups: Group[];
  selectedGroup: string;
  initialSource?: 'file' | 'manual';
}) {
  const [mode, setMode] = useState(groups.length ? 'existing' : 'new');
  const [source, setSource] = useState<'file' | 'manual'>(initialSource);
  return (
    <ActionForm action={action} id="upload_form">
      <input type="hidden" name="source" value={source} />
      <div className="btn-group mb-4" role="group" aria-label="How to add contacts">
        <input type="radio" className="btn-check" name="source_pick" id="src_file" checked={source === 'file'} onChange={() => setSource('file')} />
        <label className="btn btn-outline-primary" htmlFor="src_file"><i className="ri-file-excel-2-line" /> Upload a File</label>
        <input type="radio" className="btn-check" name="source_pick" id="src_manual" checked={source === 'manual'} onChange={() => setSource('manual')} />
        <label className="btn btn-outline-primary" htmlFor="src_manual"><i className="ri-user-add-line" /> Add Manually</label>
      </div>

      {source === 'file' ? (
        <div className="mb-4">
          <label htmlFor="file" className="form-label">Contacts File <span className="text-danger">*</span></label>
          <input type="file" className="form-control" name="file" id="file" accept=".csv,.txt,.xlsx" required />
          <div className="form-text">Excel (.xlsx), CSV or TXT, up to 20 MB. The first sheet of an Excel file is used.</div>
          <FieldError name="file" />
        </div>
      ) : <ManualRows />}

      <div className="mb-4">
        <span className="form-label d-block">Add the contacts to</span>
        <div className="form-check">
          <input className="form-check-input" type="radio" name="group_mode" id="mode_new" value="new" checked={mode === 'new'} onChange={() => setMode('new')} />
          <label className="form-check-label" htmlFor="mode_new">A new group</label>
        </div>
        <div className="ms-4 mb-2" id="new_wrap" hidden={mode !== 'new'}>
          <input type="text" className="form-control" name="group_name" id="group_name" maxLength={100} placeholder="e.g. Jaipur customers — Oct 2026" aria-label="New group name" required={mode === 'new'} />
          <FieldError name="group_name" />
        </div>
        <div className="form-check">
          <input className="form-check-input" type="radio" name="group_mode" id="mode_existing" value="existing" checked={mode === 'existing'} onChange={() => setMode('existing')} disabled={!groups.length} />
          <label className="form-check-label" htmlFor="mode_existing">An existing group</label>
        </div>
        <div className="ms-4 mb-2" id="existing_wrap" hidden={mode !== 'existing'}>
          <select className="form-select" name="group_id" id="group_id" aria-label="Existing group" defaultValue={selectedGroup}>
            {groups.map((g) => <option key={g.ug_id} value={g.ug_id}>{g.up_group_name}</option>)}
          </select>
          <FieldError name="group_id" />
        </div>
        <div className="form-check">
          <input className="form-check-input" type="radio" name="group_mode" id="mode_none" value="none" checked={mode === 'none'} onChange={() => setMode('none')} />
          <label className="form-check-label" htmlFor="mode_none">No group — just save the contacts</label>
        </div>
        <FieldError name="group_mode" />
      </div>

      <div className="form-check form-switch mb-4">
        <input className="form-check-input" type="checkbox" role="switch" name="overwrite_names" value="1" id="overwrite_names" />
        <label className="form-check-label" htmlFor="overwrite_names">Replace names of contacts I already have with the names {source === 'file' ? 'in this file' : 'entered here'}</label>
        <div className="form-text">Off: existing names are kept and only empty names are filled in.</div>
      </div>

      <UploadButton manual={source === 'manual'} />
    </ActionForm>
  );
}

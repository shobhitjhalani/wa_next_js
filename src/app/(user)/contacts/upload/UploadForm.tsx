'use client';

import { useState } from 'react';
import { ActionForm, FieldError, useActionForm } from '@/components/ActionForm';
import type { ActionResult } from '@/lib/actions';

interface Group { ug_id: number; up_group_name: string }

function UploadButton() {
  const { pending } = useActionForm();
  return (
    <button type="submit" className="btn btn-success" id="upload_btn" disabled={pending}>
      <i className="ri-upload-cloud-2-line" /> <span>{pending ? 'Uploading… large files can take a minute' : 'Upload Contacts'}</span>
    </button>
  );
}

/** The upload form with the new / existing / no group choice. */
export function UploadForm({ action, groups, selectedGroup }: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  groups: Group[];
  selectedGroup: string;
}) {
  const [mode, setMode] = useState(groups.length ? 'existing' : 'new');
  return (
    <ActionForm action={action} id="upload_form">
      <div className="mb-4">
        <label htmlFor="file" className="form-label">Contacts File <span className="text-danger">*</span></label>
        <input type="file" className="form-control" name="file" id="file" accept=".csv,.txt,.xlsx" required />
        <div className="form-text">Excel (.xlsx), CSV or TXT, up to 20 MB. The first sheet of an Excel file is used.</div>
        <FieldError name="file" />
      </div>

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
        <label className="form-check-label" htmlFor="overwrite_names">Replace names of contacts I already have with the names in this file</label>
        <div className="form-text">Off: existing names are kept and only empty names are filled in.</div>
      </div>

      <UploadButton />
    </ActionForm>
  );
}

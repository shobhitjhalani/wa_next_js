'use client';

import { useEffect, useState } from 'react';
import { ActionForm, FieldError, FormAlert, useActionForm } from '@/components/ActionForm';
import { modal } from '@/components/ui';
import type { ActionResult } from '@/lib/actions';

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

function NameInput() {
  const { state } = useActionForm();
  const bad = !!state?.errors?.name;
  return (
    <input type="text" className={`form-control${bad ? ' is-invalid' : ''}`} name="name" maxLength={100} placeholder="New group name" aria-label="New group name" required />
  );
}

/** "New group name" + Create Group in the card header. */
export function CreateGroupForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="col-md-6 col-lg-5 ms-auto" resetOnSuccess showAlert={false}>
      <div className="d-flex gap-2">
        <NameInput />
        <button type="submit" className="btn btn-success text-nowrap"><i className="ri-add-line" /> Create Group</button>
      </div>
      <FieldError name="name" />
    </ActionForm>
  );
}

/** Rename modal; opened by buttons with data-bs-target="#rename_modal" data-id data-name. */
export function RenameGroupModal({ action }: { action: Action }) {
  const [target, setTarget] = useState<{ n: number; id: string; name: string }>({ n: 0, id: '', name: '' });
  useEffect(() => {
    const el = document.getElementById('rename_modal');
    if (!el) return;
    const onShow = (e: Event) => {
      const btn = (e as Event & { relatedTarget?: HTMLElement }).relatedTarget;
      setTarget((t) => ({ n: t.n + 1, id: btn?.dataset.id ?? '', name: btn?.dataset.name ?? '' }));
    };
    el.addEventListener('show.bs.modal', onShow);
    return () => el.removeEventListener('show.bs.modal', onShow);
  }, []);

  return (
    <div className="modal fade" id="rename_modal" tabIndex={-1} aria-labelledby="rename_title" aria-hidden="true">
      <div className="modal-dialog modal-sm">
        <ActionForm key={target.n} action={action} className="modal-content" id="rename_form" showAlert={false} onResult={(r) => { if (r.ok) modal('rename_modal', 'hide'); }}>
          <input type="hidden" name="id" value={target.id} />
          <div className="modal-header">
            <h5 className="modal-title" id="rename_title">Rename Group</h5>
            <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body">
            <FormAlert />
            <label htmlFor="rename_name" className="form-label">Group Name</label>
            <input type="text" className="form-control" name="name" id="rename_name" maxLength={100} required defaultValue={target.name} />
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

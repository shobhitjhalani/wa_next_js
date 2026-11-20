'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { editMedia } from './actions';
import { LIBRARY_MAX_MB, LIBRARY_TYPES, sizeLabel } from './library';

/** "Edit" on a Media Library row: rename it and / or upload a new file in its place (same URL, same type). */
export function EditMedia({ id, name, url, thumb, ext, size }: { id: number; name: string; url: string; thumb: string; ext: string; size: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const isImage = LIBRARY_TYPES[ext]?.kind === 'image';
  const accept = ext === 'jpg' || ext === 'jpeg' ? '.jpg,.jpeg' : `.${ext}`;

  useEffect(() => {
    if (!file || !isImage) { setPreview(''); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const wrongType = file && !(file.name.toLowerCase().endsWith(`.${ext}`) || (accept.includes('.jpeg') && /\.jpe?g$/i.test(file.name)));

  return (
    <>
      <button type="button" className="btn btn-sm btn-soft-primary me-1" title="Edit / replace file" onClick={() => { setFile(null); setOpen(true); }}>
        <i className="ri-pencil-line" />
      </button>
      {open && (
        <>
          <div className="modal d-block text-start" tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Edit ${name}`} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <ActionForm action={editMedia} showAlert onResult={(r) => { if (r.ok) { router.refresh(); if (r.message !== 'Nothing changed.') setTimeout(() => setOpen(false), 1200); } }}>
                  <div className="modal-header">
                    <h5 className="modal-title">Edit file</h5>
                    <button type="button" className="btn-close" aria-label="Close" onClick={() => setOpen(false)} />
                  </div>
                  <div className="modal-body text-wrap">
                    <input type="hidden" name="id" value={id} />
                    <div className="mb-3">
                      <label className="form-label" htmlFor={`em-name-${id}`}>Name</label>
                      <input className="form-control" id={`em-name-${id}`} name="name" defaultValue={name} maxLength={120} />
                      <FieldError name="name" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label" htmlFor={`em-file-${id}`}>Replace with a new file <span className="text-muted fw-normal">(optional)</span></label>
                      <input className="form-control" type="file" id={`em-file-${id}`} name="file" accept={accept}
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                      <div className="form-text">
                        A <b>.{ext}</b> file, up to {LIBRARY_MAX_MB} MB. Now: {sizeLabel(size)}{file && !wrongType ? <> → new: {sizeLabel(file.size)}</> : null}.
                      </div>
                      {wrongType && <div className="small text-danger mt-1">This is not a .{ext} file: the URL ends in .{ext}, so the new file must be the same type.</div>}
                      <FieldError name="file" />
                      {isImage && (
                        <div className="d-flex gap-3 align-items-center mt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb} alt="Current" className="rounded border" style={{ width: 96, height: 96, objectFit: 'cover' }} />
                          {preview && <><i className="ri-arrow-right-line fs-4 text-muted" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={preview} alt="New" className="rounded border border-primary" style={{ width: 96, height: 96, objectFit: 'cover' }} /></>}
                        </div>
                      )}
                    </div>
                    <div className="small bg-light rounded p-2">
                      <i className="ri-link me-1" />The URL stays the same: <span className="font-monospace text-break">{url}</span>
                      <div className="text-muted mt-1">Everywhere it was shared now gets the new file. Messages already sent on WhatsApp keep the copy they were sent with.</div>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-light" onClick={() => setOpen(false)}>Cancel</button>
                    <SubmitButton className="btn btn-primary" pendingText={file ? 'Uploading…' : 'Saving…'} disabled={!!wrongType}>
                      <i className={file ? 'ri-upload-2-line' : 'ri-save-line'} /> {file ? 'Replace file' : 'Save'}
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show" />
        </>
      )}
    </>
  );
}

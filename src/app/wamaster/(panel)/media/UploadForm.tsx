'use client';

import { useState } from 'react';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { LIBRARY_ACCEPT, LIBRARY_MAX_MB, LIBRARY_TYPES, slug } from './library';
import { uploadMedia } from './actions';

/** Folder (pick or type a new one) + Name + File; the name defaults to the file's name. */
export function UploadForm({ folders }: { folders: string[] }) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');

  return (
    <ActionForm action={uploadMedia} resetOnSuccess showAlert={false} onResult={(r) => {
      const u = (r.data as { url?: string } | undefined)?.url;
      if (r.ok && u) { setDone(u); setName(''); }
    }}>
      <div className="row g-3 align-items-start">
        <div className="col-md-3">
          <label className="form-label" htmlFor="mf-folder">Folder</label>
          <input className="form-control" id="mf-folder" name="folder" list="mf-folders" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. tata-brochures" maxLength={60} autoComplete="off" />
          <datalist id="mf-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          <FieldError name="folder" />
          {folder && slug(folder) !== folder && <div className="form-text">Saved as <code>{slug(folder) || '—'}</code></div>}
        </div>
        <div className="col-md-4">
          <label className="form-label" htmlFor="mf-name">Name</label>
          <input className="form-control" id="mf-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nexon EV brochure" maxLength={120} />
          <FieldError name="name" />
          {name && <div className="form-text">File name: <code>{slug(name, 80) || '—'}</code></div>}
        </div>
        <div className="col-md-3">
          <label className="form-label" htmlFor="mf-file">File / Image</label>
          <input type="file" className="form-control" id="mf-file" name="file" accept={LIBRARY_ACCEPT} onChange={(e) => {
            const f = e.target.files?.[0];
            setDone('');
            if (!f) return;
            const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
            setProblem(!LIBRARY_TYPES[ext] ? 'This file type is not allowed.' : f.size > LIBRARY_MAX_MB * 1048576 ? `The file is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${LIBRARY_MAX_MB} MB.` : '');
            if (!name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
          }} />
          <FieldError name="file" />
          {problem && <div className="invalid-feedback d-block">{problem}</div>}
        </div>
        <div className="col-md-2 pt-md-4">
          <SubmitButton className="btn btn-success w-100 mt-md-1" pendingText="Uploading…" disabled={!!problem}><i className="ri-upload-2-line" /> Upload</SubmitButton>
        </div>
      </div>
      <div className="form-text">Images, PDF, Word, Excel, PowerPoint, video or audio, up to {LIBRARY_MAX_MB} MB. The file gets a permanent public link.</div>
      {done && (
        <div className="alert alert-success mt-3 mb-0 d-flex flex-wrap align-items-center gap-2">
          <i className="ri-checkbox-circle-line" /> Uploaded. Public URL:
          <a href={done} target="_blank" rel="noreferrer" className="text-break">{done}</a>
          <button type="button" className="btn btn-sm btn-success ms-auto" onClick={() => navigator.clipboard?.writeText(done).catch(() => undefined)}><i className="ri-file-copy-line" /> Copy</button>
        </div>
      )}
    </ActionForm>
  );
}

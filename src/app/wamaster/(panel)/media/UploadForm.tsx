'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LIBRARY_ACCEPT, LIBRARY_MAX_MB, LIBRARY_TYPES, sizeLabel, slug } from './library';
import { uploadMedia } from './actions';
import { UrlListActions } from './UrlTools';

interface Item { key: string; file: File; name: string; state: 'wait' | 'up' | 'ok' | 'err'; url?: string; error?: string }

const MAX_FILES = 200;

function fileProblem(f: File): string {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (!LIBRARY_TYPES[ext]) return 'File type not allowed';
  if (f.size > LIBRARY_MAX_MB * 1048576) return `${(f.size / 1048576).toFixed(1)} MB; the limit is ${LIBRARY_MAX_MB} MB`;
  return '';
}

/** "Nexon_EV-brochure.pdf" → "Nexon EV brochure" (a name with no letters or digits becomes "file"). */
function baseName(f: File): string {
  const n = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return slug(n, 80) ? n : 'file';
}

const retryable = (x: Item) => x.state === 'wait' || (x.state === 'err' && !fileProblem(x.file));

let seq = 0;

/**
 * Folder + one or many files (choose or drag & drop; documents and images). One file: its Name can be edited.
 * Several files: each is named after its own file name. Files are sent one by one (each request stays under the
 * web server's size limit) into the same folder, and every file gets its own public URL.
 */
export function UploadForm({ folders }: { folders: string[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<Record<string, string>>({});

  const single = items.length === 1;
  const nameFor = (it: Item) => (single ? name.trim() || it.name : it.name);
  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /** Add files to the list (the same file twice is ignored). */
  const add = (list: FileList | File[] | null) => {
    const incoming = [...(list ?? [])];
    if (!incoming.length) return;
    setError({});
    const seen = new Set(items.map((x) => `${x.file.name}|${x.file.size}|${x.file.lastModified}`));
    const fresh = incoming.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`));
    const room = Math.max(0, MAX_FILES - items.length);
    const next: Item[] = fresh.slice(0, room).map((f) => {
      const problem = fileProblem(f);
      return { key: `f${++seq}`, file: f, name: baseName(f), state: problem ? 'err' : 'wait', error: problem || undefined };
    });
    if (fresh.length > room) setError({ file: `Up to ${MAX_FILES} files at a time; ${fresh.length - room} file(s) were not added.` });
    const all = [...items, ...next];
    setItems(all);
    if (all.length === 1) setName(all[0].name);
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = (key: string) => {
    const rest = items.filter((x) => x.key !== key);
    setItems(rest);
    if (rest.length === 1) setName(rest[0].name);
  };

  const upload = async () => {
    const errs: Record<string, string> = {};
    if (!slug(folder)) errs.folder = 'Enter a folder name (letters and digits).';
    if (!items.length) errs.file = 'Choose or drop one or more files.';
    else if (single && !slug(nameFor(items[0]), 80)) errs.name = 'Enter a name for the file (letters and digits).';
    setError(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    for (const it of items.filter(retryable)) {
      update(it.key, { state: 'up', error: undefined });
      const fd = new FormData();
      fd.set('folder', folder);
      fd.set('name', nameFor(it));
      fd.set('file', it.file);
      try {
        const r = await uploadMedia(null, fd);
        const u = (r.data as { url?: string } | undefined)?.url;
        if (r.ok && u) update(it.key, { state: 'ok', url: u, name: nameFor(it) });
        else update(it.key, { state: 'err', error: Object.values(r.errors ?? {})[0] ?? r.error ?? 'Upload failed' });
      } catch {
        update(it.key, { state: 'err', error: 'The connection was interrupted; click Upload again to retry.' });
      }
    }
    setBusy(false);
    router.refresh();
  };

  const clear = () => {
    setItems([]); setName(''); setError({});
    if (fileRef.current) fileRef.current.value = '';
  };

  const done = items.filter((x) => x.state === 'ok');
  const failed = items.filter((x) => x.state === 'err');
  const pending = items.filter(retryable).length;
  const finished = items.length > 0 && !busy && pending === 0;

  return (
    <div>
      <div className="row g-3 align-items-start">
        <div className="col-md-4">
          <label className="form-label" htmlFor="mf-folder">Folder</label>
          <input className="form-control" id="mf-folder" list="mf-folders" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. tata-brochures" maxLength={60} autoComplete="off" disabled={busy} />
          <datalist id="mf-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          {error.folder && <div className="invalid-feedback d-block">{error.folder}</div>}
          {folder && slug(folder) !== folder && <div className="form-text">Saved as <code>{slug(folder) || '—'}</code></div>}
        </div>
        <div className="col-md-5">
          <label className="form-label" htmlFor="mf-name">Name</label>
          {items.length > 1 ? (
            <div className="form-control bg-light text-muted" id="mf-name">Each file is named after its file name</div>
          ) : (
            <input className="form-control" id="mf-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy || !single} maxLength={120}
              placeholder={single ? 'e.g. Nexon EV brochure' : 'Taken from the file name'} />
          )}
          {error.name && <div className="invalid-feedback d-block">{error.name}</div>}
          {single && name && <div className="form-text">File name: <code>{slug(name, 80) || '—'}</code></div>}
        </div>
        <div className="col-md-3 pt-md-4">
          {finished ? (
            <button type="button" className="btn btn-soft-primary w-100 mt-md-1" onClick={clear}><i className="ri-add-line" /> Upload more</button>
          ) : (
            <button type="button" className="btn btn-success w-100 mt-md-1" onClick={upload} disabled={busy || (items.length > 0 && pending === 0)}>
              {busy
                ? <><span className="spinner-border spinner-border-sm me-1" />Uploading {done.length + 1} of {done.length + pending}…</>
                : <><i className="ri-upload-2-line" /> Upload{pending > 1 ? ` ${pending} files` : ''}</>}
            </button>
          )}
        </div>
      </div>

      {/* Drop area: click to choose, or drag files here */}
      <div
        role="button" tabIndex={0} aria-label="Choose or drop files"
        className={`mt-3 rounded p-4 text-center ${drag ? 'border-primary bg-primary-subtle' : 'bg-light'}`}
        style={{ border: '2px dashed var(--bs-border-color)', borderColor: drag ? 'var(--bs-primary)' : undefined, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileRef.current?.click(); } }}
        onDragEnter={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) add(e.dataTransfer.files); }}
      >
        <i className="ri-upload-cloud-2-line fs-1 text-primary d-block" />
        <div className="fw-semibold">{drag ? 'Drop the files to add them' : 'Drag & drop files here, or click to choose'}</div>
        <div className="small text-muted">
          Documents (PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP), images, video or audio · up to {LIBRARY_MAX_MB} MB each · up to {MAX_FILES} files at a time.
          Every file gets its own public link.
        </div>
        <input ref={fileRef} type="file" multiple className="d-none" id="mf-file" accept={LIBRARY_ACCEPT} disabled={busy} onChange={(e) => add(e.target.files)} />
      </div>
      {error.file && <div className="invalid-feedback d-block">{error.file}</div>}

      {items.length > 0 && !(finished && single && done.length === 1) && (
        <div className="border rounded mt-3">
          <div className="d-flex flex-wrap align-items-center gap-2 p-2 border-bottom bg-light">
            <span className="small fw-semibold me-auto">
              {items.length} file(s){done.length > 0 && ` · ${done.length} uploaded`}{failed.length > 0 && <span className="text-danger"> · {failed.length} failed</span>}
            </span>
            {done.length > 0 && <UrlListActions rows={done.map((x) => ({ folder: slug(folder), name: x.name, url: x.url! }))} filename={`${slug(folder) || 'media'}-urls.csv`} />}
            {!busy && <button type="button" className="btn btn-sm btn-light" onClick={clear}>Clear list</button>}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="table table-sm align-middle mb-0">
              <tbody>
                {items.map((it) => (
                  <tr key={it.key}>
                    <td style={{ width: 28 }} className="text-center">
                      {it.state === 'up' ? <span className="spinner-border spinner-border-sm text-primary" />
                        : it.state === 'ok' ? <i className="ri-checkbox-circle-fill text-success" />
                          : it.state === 'err' ? <i className="ri-error-warning-fill text-danger" />
                            : <i className="ri-time-line text-muted" />}
                    </td>
                    <td className="small text-truncate" style={{ maxWidth: 260 }} title={it.file.name}>
                      {nameFor(it)}<div className="text-muted">{it.file.name} · {sizeLabel(it.file.size)}</div>
                    </td>
                    <td className="small">
                      {it.url
                        ? <a href={it.url} target="_blank" rel="noreferrer" className="text-break font-monospace">{it.url}</a>
                        : it.error ? <span className="text-danger">{it.error}</span>
                          : <span className="text-muted">{it.state === 'up' ? 'Uploading…' : 'Ready'}</span>}
                    </td>
                    <td style={{ width: 36 }} className="text-end">
                      {!busy && it.state !== 'ok' && (
                        <button type="button" className="btn btn-sm btn-link text-muted p-0" onClick={() => remove(it.key)} aria-label={`Remove ${it.file.name}`} title="Remove"><i className="ri-close-line fs-5" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {finished && single && done.length === 1 && (
        <div className="alert alert-success mt-3 mb-0 d-flex flex-wrap align-items-center gap-2">
          <i className="ri-checkbox-circle-line" /> Uploaded. Public URL:
          <a href={done[0].url} target="_blank" rel="noreferrer" className="text-break">{done[0].url}</a>
          <button type="button" className="btn btn-sm btn-success ms-auto" onClick={() => navigator.clipboard?.writeText(done[0].url!).catch(() => undefined)}><i className="ri-file-copy-line" /> Copy</button>
        </div>
      )}
    </div>
  );
}

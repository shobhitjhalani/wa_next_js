'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { addPage, uploadPosts } from './actions';

export function UploadPostsForm({ pages }: { pages: { id: number; name: string }[] }) {
  return (
    <ActionForm action={uploadPosts}>
      <div className="row g-3 align-items-start">
        <div className="col-md-4">
          <label className="form-label" htmlFor="fb-page">Facebook Page</label>
          <select className="form-select" id="fb-page" name="page_id" defaultValue={pages.length === 1 ? pages[0].id : ''}>
            <option value="">Choose a Page…</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <FieldError name="page_id" />
        </div>
        <div className="col-md-4">
          <label className="form-label" htmlFor="fb-csv">CSV file</label>
          <input type="file" className="form-control" id="fb-csv" name="csv" accept=".csv,text/csv" />
          <FieldError name="csv" />
        </div>
        <div className="col-md-2">
          <label className="form-label" htmlFor="fb-start">Start <span className="text-muted fw-normal">(optional)</span></label>
          <input type="datetime-local" className="form-control" id="fb-start" name="start" />
          <FieldError name="start" />
        </div>
        <div className="col-md-2 pt-md-4">
          <SubmitButton className="btn btn-success w-100 mt-md-1" pendingText="Uploading…"><i className="ri-upload-2-line" /> Queue posts</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function AddPageForm({ clients }: { clients: { id: number; name: string }[] }) {
  return (
    <ActionForm action={addPage} resetOnSuccess>
      <div className="mb-3">
        <label className="form-label" htmlFor="fp-token">Page access token</label>
        <textarea className="form-control font-monospace small" id="fp-token" name="token" rows={3} autoComplete="off" spellCheck={false}
          placeholder="EAAB… (a Page token with pages_manage_posts and pages_read_engagement)" />
        <FieldError name="token" />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="fp-user">Client account <span className="text-muted fw-normal">(optional)</span></label>
        <select className="form-select" id="fp-user" name="user_id" defaultValue="0">
          <option value="0">—</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <SubmitButton className="btn btn-primary" pendingText="Checking with Facebook…"><i className="ri-facebook-circle-line" /> Connect Page</SubmitButton>
    </ActionForm>
  );
}

/** Reload the status every 15 s while posts are still queued / posting. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [active, router]);
  return active ? <span className="small text-muted"><span className="spinner-border spinner-border-sm me-1" />Updating every 15 seconds</span> : null;
}

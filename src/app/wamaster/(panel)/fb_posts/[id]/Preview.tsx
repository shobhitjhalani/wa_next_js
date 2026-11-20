import Link from 'next/link';
import { ConfirmButton } from '@/components/ui';
import { query } from '@/lib/db';
import { now, phpDate } from '@/lib/time';
import { confirmBatch, discardBatch } from '../actions';
import { PreviewImage } from './PreviewImage';

interface Row {
  po_line: number; po_message: string; po_link: string; po_image_url: string; po_scheduled_at: number;
  fp_id: number; fp_name: string; fp_page_id: string;
}
interface Card { line: number; message: string; link: string; image: string; at: number; pages: { id: number; name: string; pageId: string }[] }

function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** Draft upload: every post as it will look (image, caption, link, schedule) and the Pages it goes to; Confirm queues it. */
export async function Preview({ batch, canAdd }: { batch: { pb_id: number; pb_file: string; pb_total: number; pb_created_on: number }; canAdd: boolean }) {
  const rows = await query<Row>(
    `SELECT p.po_line, p.po_message, p.po_link, p.po_image_url, p.po_scheduled_at, f.fp_id, f.fp_name, f.fp_page_id
       FROM js_fb_post p JOIN js_fb_page f ON f.fp_id = p.po_page_id
      WHERE p.po_batch_id = $1 ORDER BY p.po_line, lower(f.fp_name)`, [batch.pb_id]);
  const cards = new Map<number, Card>();
  const allPages = new Map<number, { name: string; pageId: string; n: number }>();
  for (const r of rows) {
    const c = cards.get(r.po_line) ?? { line: r.po_line, message: r.po_message, link: r.po_link, image: r.po_image_url, at: r.po_scheduled_at, pages: [] };
    c.pages.push({ id: r.fp_id, name: r.fp_name, pageId: r.fp_page_id });
    cards.set(r.po_line, c);
    const p = allPages.get(r.fp_id) ?? { name: r.fp_name, pageId: r.fp_page_id, n: 0 };
    p.n++;
    allPages.set(r.fp_id, p);
  }
  const list = [...cards.values()];
  const t = now();
  const when = (at: number) => (at <= t + 60 ? 'As soon as you confirm' : phpDate('d M Y, h:i A', at));
  const confirmMsg = `Queue ${rows.length} post(s) on ${allPages.size} Page(s)? They are published from now on (or at their schedule).`;

  const actions = canAdd && (
    <div className="d-flex flex-wrap gap-2">
      <form action={discardBatch.bind(null, batch.pb_id)}>
        <ConfirmButton message="Discard this upload? Nothing has been posted." className="btn btn-light"><i className="ri-close-line" /> Discard</ConfirmButton>
      </form>
      <form action={confirmBatch.bind(null, batch.pb_id)}>
        <ConfirmButton message={confirmMsg} className="btn btn-success"><i className="ri-send-plane-fill" /> Confirm &amp; queue {rows.length} post(s)</ConfirmButton>
      </form>
    </div>
  );

  return (
    <>
      <div className="card border-warning">
        <div className="card-header d-flex flex-wrap align-items-center gap-3">
          <div className="me-auto">
            <h5 className="card-title mb-1"><span className="badge bg-warning-subtle text-warning me-2">Preview</span>#{batch.pb_id} · {batch.pb_file}</h5>
            <div className="small text-muted">
              {list.length} post(s) × {allPages.size} Page(s) = <b>{rows.length}</b> posts · uploaded {phpDate('d M Y, h:i A', batch.pb_created_on)} · nothing is posted until you confirm
            </div>
          </div>
          {actions}
        </div>
        <div className="card-body">
          <div className="small fw-semibold mb-2">Will be posted on these {allPages.size} Page(s):</div>
          <div className="d-flex flex-wrap gap-2">
            {[...allPages.entries()].map(([id, p]) => (
              <a key={id} href={`https://www.facebook.com/${p.pageId}`} target="_blank" rel="noreferrer" className="badge bg-primary-subtle text-primary fw-normal fs-6 text-decoration-none">
                <i className="ri-facebook-circle-fill" /> {p.name} <span className="opacity-75">({p.n})</span>
              </a>
            ))}
          </div>
          {!canAdd && <p className="small text-muted mt-3 mb-0">Confirming needs the Add right.</p>}
        </div>
      </div>

      <div className="row g-3 align-items-start">
        {list.map((c) => (
          <div key={c.line} className="col-md-6 col-xxl-4">
            <div className="card mb-0 shadow-sm">
              {/* Facebook-like post */}
              <div className="card-body pb-2">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <span className="rounded-circle bg-primary text-white fw-semibold d-inline-grid flex-none" style={{ width: 40, height: 40, placeItems: 'center' }}>{initial(c.pages[0]?.name ?? '')}</span>
                  <div className="min-w-0 me-auto">
                    <div className="fw-semibold text-truncate">{c.pages[0]?.name}{c.pages.length > 1 && <span className="text-muted fw-normal"> and {c.pages.length - 1} more Page(s)</span>}</div>
                    <div className="small text-muted"><i className="ri-time-line" /> {when(c.at)} · <i className="ri-earth-line" /></div>
                  </div>
                  <span className="badge bg-light text-muted border" title="CSV line">Line {c.line}</span>
                </div>
                {c.message
                  ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto' }}>{c.message}</div>
                  : <div className="small text-muted fst-italic">No caption</div>}
                {c.link && c.image && <a href={c.link} target="_blank" rel="noreferrer" className="d-block small text-break mt-1">{c.link}</a>}
              </div>
              {c.image && <PreviewImage src={c.image} />}
              {c.link && !c.image && (
                <a href={c.link} target="_blank" rel="noreferrer" className="d-block border-top bg-light px-3 py-2 text-decoration-none">
                  <div className="small text-muted text-uppercase">{host(c.link)}</div>
                  <div className="small text-body text-break">{c.link}</div>
                  <div className="small text-muted">Facebook shows the page’s title and picture here</div>
                </a>
              )}
              <div className="card-footer bg-transparent small">
                <div className="text-muted mb-1">Will be posted on:</div>
                <div className="d-flex flex-wrap gap-1">
                  {c.pages.map((p) => <span key={p.id} className="badge bg-light text-body border fw-normal">{p.name}</span>)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mt-3 mb-4">
        <Link href="/wamaster/fb_posts" className="btn btn-link text-muted me-auto"><i className="ri-arrow-left-line" /> Back to uploads (the draft is kept 3 days)</Link>
        {actions}
      </div>
    </>
  );
}

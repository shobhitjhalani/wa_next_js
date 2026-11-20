'use client';

import { useEffect, useRef, useState } from 'react';

export interface UrlRow { folder: string; name: string; url: string }

function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Save rows as a CSV (folder, name, url) that Excel opens as UTF-8. */
export function downloadUrlsCsv(rows: UrlRow[], filename: string) {
  const body = '﻿' + ['folder,name,url', ...rows.map((r) => [r.folder, r.name, r.url].map(cell).join(','))].join('\r\n') + '\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** "Copy URLs" (one per line) + "Download CSV" for a list of uploaded files. */
export function UrlListActions({ rows, filename }: { rows: UrlRow[]; filename: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm btn-soft-primary" disabled={!rows.length}
        onClick={() => navigator.clipboard?.writeText(rows.map((r) => r.url).join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}>
        <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} /> {copied ? 'Copied' : `Copy ${rows.length} URL${rows.length === 1 ? '' : 's'}`}
      </button>
      <button type="button" className="btn btn-sm btn-soft-success" disabled={!rows.length} onClick={() => downloadUrlsCsv(rows, filename)}>
        <i className="ri-download-2-line" /> Download CSV
      </button>
    </>
  );
}

/**
 * Tick files in the table below (inputs with data-url / data-name / data-folder) and copy or download
 * their URLs; a header checkbox (data-select-all) ticks every file on the page.
 */
export function MediaSelection({ exportHref, total, children }: { exportHref: string; total: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<UrlRow[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const items = () => [...el.querySelectorAll<HTMLInputElement>('input[data-url]')];
    const read = () => {
      const all = items();
      const ticked = all.filter((i) => i.checked);
      setRows(ticked.map((i) => ({ folder: i.dataset.folder ?? '', name: i.dataset.name ?? '', url: i.dataset.url ?? '' })));
      const head = el.querySelector<HTMLInputElement>('input[data-select-all]');
      if (head) { head.checked = all.length > 0 && ticked.length === all.length; head.indeterminate = ticked.length > 0 && ticked.length < all.length; }
    };
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.matches('input[data-select-all]')) items().forEach((i) => { i.checked = t.checked; });
      if (t.matches('input[data-select-all], input[data-url]')) read();
    };
    el.addEventListener('change', onChange);
    read();
    return () => el.removeEventListener('change', onChange);
  }, [children]);

  const clear = () => {
    box.current?.querySelectorAll<HTMLInputElement>('input[data-url], input[data-select-all]').forEach((i) => { i.checked = false; i.indeterminate = false; });
    setRows([]);
  };

  return (
    <div ref={box}>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        {rows.length > 0 ? (
          <>
            <span className="small fw-semibold">{rows.length} selected</span>
            <UrlListActions rows={rows} filename="media-urls.csv" />
            <button type="button" className="btn btn-sm btn-light" onClick={clear}>Clear</button>
          </>
        ) : <span className="small text-muted">Tick files to copy or download their URLs.</span>}
        <a href={exportHref} className="btn btn-sm btn-soft-secondary ms-auto" aria-disabled={!total}><i className="ri-file-download-line" /> Download all {total} URLs (CSV)</a>
      </div>
      {children}
    </div>
  );
}

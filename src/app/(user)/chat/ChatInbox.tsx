'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react';
import { SendTemplateModal } from './SendTemplateModal';
import type { Bubble, ConvRow, ListResponse, PollResponse, RenderedTemplate, SendResponse, TemplateHeader, ThreadHeader, ThreadResponse } from './types';

/**
 * The inbox page script (index.blade.php's inline jQuery): conversation list
 * with search / filters / infinite scroll, paged thread, 24-hour window,
 * composer with one attachment, and polling every 5 s (30 s while hidden).
 */

const URLS = {
  list: '/chat/conversations',
  thread: '/chat/thread',
  poll: '/chat/poll',
  send: '/chat/send',
  inbox: '/chat',
};
const POLL_VISIBLE = 5000;
const POLL_HIDDEN = 30000;

interface Pending {
  temp: string;
  day: string;
  text: string;
  error?: string;
}
type Item = Bubble | Pending;
const isPending = (i: Item): i is Pending => 'temp' in i;

interface Composer {
  open: boolean;
  mobile: string;
  status: string;
}

class HttpError extends Error {
  constructor(public status: number, public body: any) {
    super('HTTP ' + status);
  }
}

async function getJSON<T>(url: string, params: Record<string, string | number | undefined | null>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.append(k, String(v));
  const res = await fetch(url + '?' + qs.toString(), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, body);
  return body as T;
}

const hueStyle = (hue: number) => ({ '--hue': String(hue) }) as CSSProperties;

let dayFormat: Intl.DateTimeFormat | null = null;
function dayLabel(day: string): string {
  dayFormat ??= new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const d = new Date(day + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : dayFormat.format(d);
}

export function ChatInbox({ selected, unreadTotal }: { selected: string; unreadTotal: number }) {
  const st = useRef({
    filter: 'all', q: '', listBefore: null as number | null, listMore: false, listLoading: false, listReq: 0,
    mobile: null as string | null, oldest: null as number | null, newest: 0, more: false, olderLoading: false, threadReq: 0,
    windowLeft: 0, windowAt: 0, since: 0, sending: 0, pollTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    searchTimer: undefined as ReturnType<typeof setTimeout> | undefined, alive: false, baseTitle: '',
  }).current;

  const [rows, setRows] = useState<ConvRow[]>([]);
  const rowsRef = useRef<ConvRow[]>([]);
  const [listState, setListState] = useState<string | null>('Loading…');
  const [unread, setUnread] = useState(unreadTotal);
  const [mobile, setMobile] = useState<string | null>(null);
  const [showThread, setShowThread] = useState(false);
  const [head, setHead] = useState<ThreadHeader | 'loading' | 'error' | null>(null);
  const [msgs, setMsgs] = useState<Item[]>([]);
  const msgsRef = useRef<Item[]>([]);
  const [noMsgs, setNoMsgs] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [newPill, setNewPill] = useState(false);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [fileName, setFileName] = useState('');
  const [composerError, setComposerError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [templateFor, setTemplateFor] = useState<{ mobile: string; name: string } | null>(null);
  const closeTemplate = useCallback(() => setTemplateFor(null), []);

  const listRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const scrollAfter = useRef<'bottom' | { fromBottom: number } | null>(null);

  const commitRows = (next: ConvRow[]) => { rowsRef.current = next; setRows(next); };
  const commitMsgs = (next: Item[]) => { msgsRef.current = next; setMsgs(next); };

  // ------------------------------------------------------------ list
  function loadList(reset: boolean) {
    if (st.listLoading && !reset) return;
    if (reset) st.listBefore = null;
    const req = ++st.listReq;
    st.listLoading = true;
    setListState('Loading…');
    getJSON<ListResponse>(URLS.list, { filter: st.filter, q: st.q, before: st.listBefore ?? undefined })
      .then((res) => {
        if (req !== st.listReq) return; // a newer search/filter replaced this one
        const base = reset ? [] : rowsRef.current;
        const have = new Set(base.map((r) => r.mobile));
        const next = [...base, ...res.rows.filter((r) => !have.has(r.mobile))];
        commitRows(next);
        st.listBefore = res.before;
        st.listMore = res.more;
        setUnreadTotal(res.unread_total);
        setListState(next.length ? null : st.q ? 'No conversations match your search.' : 'No conversations here yet.');
      })
      .catch(() => { if (req === st.listReq) setListState('Could not load conversations.'); })
      .finally(() => { if (req === st.listReq) st.listLoading = false; });
  }

  // Place an updated row by recency; rows that belong below the loaded page are left for paging
  function upsertRow(m: string, row: ConvRow) {
    const list = rowsRef.current.filter((r) => r.mobile !== m);
    const idx = list.findIndex((r) => r.last < row.last);
    if (idx >= 0) list.splice(idx, 0, row);
    else if (!st.listMore) list.push(row);
    commitRows(list);
    setListState(null);
  }

  function onSearch(value: string) {
    clearTimeout(st.searchTimer);
    const v = value.trim();
    st.searchTimer = setTimeout(() => { st.q = v; loadList(true); }, 300);
  }

  function onRowClick(e: MouseEvent<HTMLAnchorElement>, m: string) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return; // let the link open in a new tab
    e.preventDefault();
    openThread(m);
  }

  // ------------------------------------------------------------ thread
  function openThread(m: string) {
    const req = ++st.threadReq;
    st.mobile = String(m);
    st.oldest = null; st.newest = 0; st.more = false;
    setTemplateNotice('');
    setMobile(st.mobile);
    setShowThread(true);
    setHead('loading');
    commitMsgs([]);
    setNoMsgs(false);
    setNewPill(false);
    setComposerError('');
    window.history.replaceState(null, '', URLS.inbox + '?mb=' + encodeURIComponent(m));

    getJSON<ThreadResponse>(URLS.thread, { mb: m })
      .then((res) => {
        if (req !== st.threadReq) return;
        setHead(res.header ?? null);
        commitMsgs(res.messages);
        st.oldest = res.oldest; st.newest = res.newest || 0; st.more = res.more;
        setWindow(res.window_left ?? 0);
        if (res.row) upsertRow(m, res.row);
        setUnreadTotal(res.unread_total ?? 0);
        setNoMsgs(!res.messages.length);
        scrollAfter.current = 'bottom';
        if (window.matchMedia('(min-width: 992px)').matches) textRef.current?.focus();
      })
      .catch(() => { if (req === st.threadReq) setHead('error'); });
  }

  function loadOlder() {
    const el = threadRef.current;
    if (!st.more || st.olderLoading || !st.oldest || !el) return;
    st.olderLoading = true;
    setOlderLoading(true);
    const req = st.threadReq;
    const fromBottom = el.scrollHeight - el.scrollTop;
    getJSON<ThreadResponse>(URLS.thread, { mb: st.mobile, before: st.oldest })
      .then((res) => {
        if (req !== st.threadReq) return;
        const have = new Set(msgsRef.current.filter((i): i is Bubble => !isPending(i)).map((i) => i.id));
        commitMsgs([...res.messages.filter((b) => !have.has(b.id)), ...msgsRef.current]);
        st.oldest = res.oldest || st.oldest; st.more = res.more;
        scrollAfter.current = { fromBottom }; // keep the reader's place
      })
      .catch(() => undefined)
      .finally(() => { st.olderLoading = false; setOlderLoading(false); });
  }

  function back() {
    setShowThread(false);
    st.mobile = null; st.threadReq++;
    setMobile(null);
    window.history.replaceState(null, '', URLS.inbox);
  }

  function nearBottom() {
    const el = threadRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }
  function scrollBottom() {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  useLayoutEffect(() => {
    const el = threadRef.current;
    const want = scrollAfter.current;
    if (!el || !want) return;
    scrollAfter.current = null;
    el.scrollTop = want === 'bottom' ? el.scrollHeight : el.scrollHeight - want.fromBottom;
  }, [msgs, noMsgs]);

  // ------------------------------------------------------------ reply window
  function setWindow(seconds: number) {
    st.windowLeft = seconds || 0;
    st.windowAt = Date.now();
    renderWindow();
  }
  function renderWindow() {
    if (!st.mobile) return;
    const left = Math.max(0, st.windowLeft - Math.floor((Date.now() - st.windowAt) / 1000));
    const open = left > 0;
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
    setComposer({ open, mobile: st.mobile, status: open ? 'Reply window: ' + (h ? h + 'h ' : '') + m + 'm left' : 'Reply window closed' });
  }

  // ------------------------------------------------------------ composer
  function autoGrow() {
    const t = textRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 140) + 'px';
  }
  function clearFile() {
    if (fileRef.current) fileRef.current.value = '';
    setFileName('');
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = textRef.current, fi = fileRef.current;
    if (!t || !fi) return;
    const text = t.value.trim(), f = fi.files?.[0] ?? null, m = st.mobile;
    if ((!text && !f) || !m) return;
    setComposerError('');

    // Show the message straight away; the server's version replaces it
    const temp = 'tmp' + (++st.sending);
    const pending: Pending = { temp, day: new Date().toISOString().slice(0, 10), text: (f ? '📎 ' + f.name + (text ? '\n' : '') : '') + text };
    setNoMsgs(false);
    commitMsgs([...msgsRef.current, pending]);
    scrollAfter.current = 'bottom';

    const data = new FormData();
    data.append('mb', m);
    data.append('msg', text);
    if (f) data.append('file', f);
    t.value = '';
    autoGrow();
    clearFile();

    fetch(URLS.send, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new HttpError(r.status, body);
        return body as SendResponse;
      })
      .then((res) => {
        if (m !== st.mobile) return;
        const exists = msgsRef.current.some((i) => !isPending(i) && i.id === res.id);
        commitMsgs(exists
          ? msgsRef.current.filter((i) => !(isPending(i) && i.temp === temp))
          : msgsRef.current.map((i) => (isPending(i) && i.temp === temp ? res.message : i)));
        st.newest = Math.max(st.newest, res.id);
        upsertRow(m, res.row);
        if (res.error) setComposerError(res.error);
      })
      .catch((err: unknown) => {
        const body = err instanceof HttpError ? err.body ?? {} : {};
        const msg: string = body.errors ? (Object.values(body.errors as Record<string, string[]>)[0]?.[0] ?? '') : (body.message || 'Message could not be sent.');
        commitMsgs(msgsRef.current.map((i) => (isPending(i) && i.temp === temp ? { ...i, error: msg } : i)));
        if (m === st.mobile && textRef.current && !textRef.current.value) { textRef.current.value = text; autoGrow(); } // give the text back to retry
        setComposerError(msg);
        if (err instanceof HttpError && err.status === 422 && /window/i.test(msg)) setWindow(0);
      });
  }

  function openTemplate() {
    const h = head && typeof head === 'object' ? head : null;
    const m = st.mobile;
    if (m) setTemplateFor({ mobile: m, name: h?.name || m });
  }

  function onTemplateSent(res: SendResponse, m: string) {
    upsertRow(m, res.row);
    if (m !== st.mobile) return;
    if (!msgsRef.current.some((i) => !isPending(i) && i.id === res.id)) commitMsgs([...msgsRef.current, res.message]);
    st.newest = Math.max(st.newest, res.id);
    setNoMsgs(false);
    scrollAfter.current = 'bottom';
    setComposerError(res.error ?? '');
    setTemplateNotice(res.error ? '' : res.notice ?? '');
  }

  // ------------------------------------------------------------ polling
  function setUnreadTotal(n: number) {
    n = Number(n) || 0;
    setUnread(n);
    document.title = (n ? '(' + n + ') ' : '') + st.baseTitle;
  }

  function schedulePoll() {
    clearTimeout(st.pollTimer);
    if (!st.alive) return;
    st.pollTimer = setTimeout(poll, document.hidden ? POLL_HIDDEN : POLL_VISIBLE);
  }

  function poll() {
    const m = st.mobile, req = st.threadReq;
    getJSON<PollResponse>(URLS.poll, {
      since: st.since, filter: st.filter, q: st.q,
      mb: m ?? undefined, after: m ? st.newest : undefined, visible: document.hidden ? 0 : 1,
    })
      .then((res) => {
        st.since = res.now;
        for (const [mb, row] of Object.entries(res.rows || {})) upsertRow(mb, row);
        setUnreadTotal(res.unread_total);
        if (!m || m !== st.mobile || req !== st.threadReq) return;

        let items = msgsRef.current;
        if (res.statuses?.length) {
          const changed = new Map(res.statuses.map((b) => [b.id, b]));
          items = items.map((i) => (!isPending(i) && changed.has(i.id) ? changed.get(i.id)! : i));
        }
        if (res.messages?.length) {
          const stick = nearBottom();
          const have = new Set(items.filter((i): i is Bubble => !isPending(i)).map((i) => i.id));
          items = [...items, ...res.messages.filter((b) => !have.has(b.id))];
          setNoMsgs(false);
          st.newest = Math.max(st.newest, res.newest || 0);
          if (stick) scrollAfter.current = 'bottom';
          else setNewPill(true);
        }
        if (items !== msgsRef.current) commitMsgs(items);
        if (typeof res.window_left === 'number') setWindow(res.window_left);
      })
      .catch(() => undefined)
      .finally(schedulePoll);
  }

  // ------------------------------------------------------------ start
  useEffect(() => {
    st.alive = true;
    st.since = Math.floor(Date.now() / 1000);
    st.baseTitle = document.title.replace(/^\(\d+\) /, '');
    setUnreadTotal(unreadTotal);
    loadList(true);
    if (selected) openThread(selected);
    schedulePoll();
    const onVisible = () => { if (!document.hidden) { clearTimeout(st.pollTimer); poll(); } };
    document.addEventListener('visibilitychange', onVisible);
    const windowTimer = setInterval(renderWindow, 30000);
    return () => {
      st.alive = false;
      clearTimeout(st.pollTimer);
      clearTimeout(st.searchTimer);
      clearInterval(windowTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ render
  const thread: React.ReactNode[] = [];
  let prevDay: string | null = null;
  for (const item of msgs) {
    if (item.day && item.day !== prevDay) {
      thread.push(<div key={'d' + item.day + (isPending(item) ? item.temp : item.id)} className="day-sep"><span>{dayLabel(item.day)}</span></div>);
    }
    prevDay = item.day;
    thread.push(isPending(item) ? <PendingBubble key={item.temp} p={item} /> : <MessageBubble key={'m' + item.id} m={item} />);
  }

  return (
    <div className="card mb-0">
      <div className={`inbox${showThread ? ' show-thread' : ''}`} id="inbox">
        <aside className="inbox-side">
          <div className="inbox-tools">
            <div className="d-flex align-items-center">
              <h5 className="mb-0 me-auto">Chats</h5>
              <span className="badge bg-success-subtle text-success" id="unread_total" hidden={!unread}>{unread} unread</span>
            </div>
            <input type="search" className="form-control" id="inbox_search" placeholder="Search name or number" aria-label="Search conversations" autoComplete="off" onChange={(e) => onSearch(e.target.value)} />
            <div className="btn-group btn-group-sm inbox-filters" role="group" aria-label="Filter conversations">
              {([['all', 'All', undefined], ['unread', 'Unread', undefined], ['active', 'Open 24h', 'Customers who wrote in the last 24 hours']] as const).map(([v, label, title]) => (
                <Fragment key={v}>
                  <input type="radio" className="btn-check" name="inbox_filter" id={'filter_' + v} value={v} defaultChecked={v === 'all'} onChange={() => { st.filter = v; loadList(true); }} />
                  <label className="btn btn-outline-secondary" htmlFor={'filter_' + v} title={title}>{label}</label>
                </Fragment>
              ))}
            </div>
          </div>
          <div
            className="inbox-list"
            id="conv_list"
            aria-live="polite"
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (st.listMore && !st.listLoading && el.scrollTop + el.clientHeight > el.scrollHeight - 200) loadList(false);
            }}
          >
            <div id="conv_rows">
              {rows.map((r) => <ConversationRow key={r.mobile} r={r} active={r.mobile === mobile} onClick={onRowClick} />)}
            </div>
            <div className="list-state" id="conv_state" hidden={listState === null}>{listState}</div>
          </div>
        </aside>

        <section className="inbox-main" aria-label="Conversation">
          <div className="inbox-empty" id="thread_empty" hidden={head !== null}>
            <div>
              <i className="ri-chat-smile-2-line display-5 d-block mb-2" />
              Select a conversation to start chatting.
            </div>
          </div>
          <div className="thread-head" id="thread_head" hidden={head === null}>
            {head === 'loading' && <span className="text-muted small">Loading…</span>}
            {head === 'error' && <span className="text-danger small">Could not load this conversation.</span>}
            {head && typeof head === 'object' && (
              <>
                <button type="button" className="btn btn-sm btn-ghost-secondary thread-back" data-action="back" aria-label="Back to conversations" onClick={back}><i className="ri-arrow-left-line fs-18" /></button>
                <span className="conv-avatar" style={hueStyle(head.hue)} aria-hidden="true">{head.initials}</span>
                <div className="thread-title">
                  <div className="fw-semibold text-truncate">{head.name}</div>
                  <div className="small text-muted text-truncate">
                    {head.showMobile && <>{head.mobile} · </>}
                    <span className={`window-status${composer?.open ? ' text-success' : ''}`}>{composer?.status ?? ''}</span>
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-soft-success ms-auto" id="thread_template" onClick={openTemplate} title="Send a template message" aria-label="Send Template"><i className="ri-file-list-3-line" /> <span className="d-none d-sm-inline">Send Template</span></button>
              </>
            )}
          </div>
          <div
            className="thread"
            id="thread"
            hidden={head === null}
            ref={threadRef}
            onScroll={(e) => {
              if (e.currentTarget.scrollTop < 120) loadOlder();
              if (nearBottom()) setNewPill(false);
            }}
          >
            <div className="thread-loading" id="thread_older" hidden={!olderLoading}>Loading earlier messages…</div>
            <div id="thread_msgs">
              {noMsgs && !msgs.length ? <p className="text-center text-muted small my-4">No messages with this number yet.</p> : thread}
            </div>
            <button type="button" className="btn btn-sm btn-light new-pill" id="new_pill" hidden={!newPill} onClick={() => { scrollBottom(); setNewPill(false); }}><i className="ri-arrow-down-line" /> New messages</button>
          </div>
          <form className="composer" id="composer" hidden={!composer?.open} ref={formRef} onSubmit={onSubmit}>
            <div className="composer-file" id="composer_file_chip" hidden={!fileName}>
              <i className="ri-attachment-2" />
              <span className="text-truncate" id="composer_file_name">{fileName}</span>
              <button type="button" className="btn-close btn-sm" id="composer_file_clear" aria-label="Remove attachment" onClick={clearFile} />
            </div>
            <div className="composer-row">
              <label className="btn btn-light mb-0" htmlFor="composer_file" title="Attach a file" aria-label="Attach a file"><i className="ri-attachment-2 fs-16" /></label>
              <input type="file" id="composer_file" hidden ref={fileRef} accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
              <textarea
                className="form-control"
                id="composer_text"
                rows={1}
                placeholder="Type a message"
                aria-label="Message"
                maxLength={4096}
                ref={textRef}
                onInput={autoGrow}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); formRef.current?.requestSubmit(); }
                }}
              />
              <button type="submit" className="btn btn-success" id="composer_send" aria-label="Send"><i className="ri-send-plane-2-fill" /></button>
            </div>
            <div className="small text-danger mt-1" id="composer_error" hidden={!composerError}>{composerError}</div>
          </form>
          <div className="composer-closed" id="composer_closed" hidden={!composer || composer.open}>
            <i className="ri-time-line" />
            <span className="small">The 24-hour reply window is closed. WhatsApp only allows a template message until the customer writes again.</span>
            <button type="button" className="btn btn-sm btn-success ms-auto" id="composer_template" onClick={openTemplate}>Send Template</button>
          </div>
          {composerError && !composer?.open && <div className="small text-danger px-3 pb-2" id="template_error">{composerError}</div>}
          {templateNotice && (
            <div className="small text-warning-emphasis bg-warning-subtle px-3 py-2 d-flex align-items-center gap-2" id="template_notice" role="status">
              <i className="ri-time-line" /> <span className="me-auto">{templateNotice}</span>
              <button type="button" className="btn-close btn-sm" aria-label="Dismiss" onClick={() => setTemplateNotice('')} />
            </div>
          )}
        </section>
      </div>
      {templateFor && (
        <SendTemplateModal
          mobile={templateFor.mobile}
          name={templateFor.name}
          onClose={closeTemplate}
          onSent={(res) => onTemplateSent(res, templateFor.mobile)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rows & bubbles

function ConversationRow({ r, active, onClick }: { r: ConvRow; active: boolean; onClick: (e: MouseEvent<HTMLAnchorElement>, mobile: string) => void }) {
  return (
    <a
      href={URLS.inbox + '?mb=' + encodeURIComponent(r.mobile)}
      className={`conv${r.unread > 0 ? ' unread' : ''}${active ? ' active' : ''}`}
      data-mobile={r.mobile}
      data-last={r.last}
      onClick={(e) => onClick(e, r.mobile)}
    >
      <span className="conv-avatar" style={hueStyle(r.hue)} aria-hidden="true">{r.initials}</span>
      <span className="conv-body">
        <span className="conv-line">
          <span className="conv-name">{r.name}</span>
          <span className="conv-time">{r.time}</span>
        </span>
        <span className="conv-line">
          <span className="conv-preview">
            {r.outgoing && <i className="ri-reply-line" aria-label="You:" />}
            {' '}{r.preview}
          </span>
          {r.live && <span className="conv-live" title="Reply window open" />}
          {r.unread > 0 && <span className="conv-badge">{r.unread > 99 ? '99+' : r.unread}</span>}
        </span>
      </span>
    </a>
  );
}

function PendingBubble({ p }: { p: Pending }) {
  return (
    <div className="chat-msg out" data-temp={p.temp} data-day={p.day}>
      <div className={`bubble ${p.error !== undefined ? 'failed' : 'pending'}`}>
        <div className="bubble-text">{p.text}</div>
        <span className="bubble-meta"><i className="ri-time-line" /></span>
        {p.error !== undefined && <div className="bubble-error">{p.error}</div>}
      </div>
    </div>
  );
}

function MediaImage({ href, type }: { href: string; type: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <a href={href} target="_blank" rel="noopener" className={`bubble-media ${type}`}>
      {broken ? '📷 Photo — open' : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={href} loading="lazy" alt={type === 'sticker' ? 'Sticker' : 'Photo'} onError={() => setBroken(true)} />
      )}
    </a>
  );
}

function TemplateHeaderView({ h }: { h: TemplateHeader }) {
  if (h.kind === 'text') return <div className="bubble-tpl-header">{h.text}</div>;
  if (h.kind === 'image') {
    return (
      <a href={h.url} target="_blank" rel="noopener" className="bubble-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={h.url} loading="lazy" alt="Header image" />
      </a>
    );
  }
  if (h.kind === 'video') return <video className="bubble-video" controls preload="metadata" src={h.url} />;
  return (
    <a href={h.url} target="_blank" rel="noopener" className="bubble-file">
      <i className="ri-file-text-line" />
      <span className="text-truncate">{h.name || 'Document'}</span>
      <i className="ri-download-2-line ms-auto" />
    </a>
  );
}

function TemplateButtons({ buttons }: { buttons: RenderedTemplate['buttons'] }) {
  if (!buttons.length) return null;
  return (
    <div className="bubble-tpl-buttons">
      {buttons.map((b, i) => <div key={i} className="bubble-tpl-button"><i className={b.icon} /> {b.text}</div>)}
    </div>
  );
}

function RenderedTemplateView({ t }: { t: RenderedTemplate }) {
  return (
    <>
      {t.header && <TemplateHeaderView h={t.header} />}
      {t.html !== '' && <div className="bubble-text" dangerouslySetInnerHTML={{ __html: t.html }} />}
      {t.footer !== '' && <div className="bubble-tpl-footer">{t.footer}</div>}
      <TemplateButtons buttons={t.buttons} />
      {t.cards.length > 0 && (
        <div className="bubble-tpl-cards">
          {t.cards.map((c, i) => (
            <div key={i} className="bubble-tpl-card">
              {c.header && <TemplateHeaderView h={c.header} />}
              {c.html !== '' && <div className="bubble-text" dangerouslySetInnerHTML={{ __html: c.html }} />}
              <TemplateButtons buttons={c.buttons} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MessageBubble({ m }: { m: Bubble }) {
  const media = m.media;
  return (
    <div className={`chat-msg ${m.out ? 'out' : 'in'}`} data-id={m.id} data-day={m.day}>
      <div className={`bubble ${m.failed ? 'failed' : ''}`}>
        {media?.kind === 'image' && <MediaImage href={media.href} type={media.type} />}
        {media?.kind === 'video' && (
          <>
            <video className="bubble-video" controls preload="metadata" src={media.href} />
            <a href={media.href} target="_blank" rel="noopener" className="small d-block mb-1"><i className="ri-download-2-line" /> Open video</a>
          </>
        )}
        {media?.kind === 'audio' && (
          <>
            <audio className="bubble-audio" controls preload="metadata" src={media.href} />
            <a href={media.href} target="_blank" rel="noopener" className="small d-block mb-1"><i className="ri-download-2-line" /> Open audio</a>
          </>
        )}
        {media?.kind === 'file' && (
          <a href={media.href} target="_blank" rel="noopener" className="bubble-file">
            <i className={media.icon} />
            <span className="text-truncate">{media.name}</span>
            <i className="ri-download-2-line ms-auto" />
          </a>
        )}
        {media?.kind === 'location' && (
          <a href={media.href} target="_blank" rel="noopener" className="bubble-file">
            <i className="ri-map-pin-2-line" />
            <span className="text-truncate">{media.name}</span>
          </a>
        )}
        {media?.kind === 'reaction' && <><span className="text-muted small">Reacted</span> <span className="fs-4">{media.emoji}</span></>}
        {media?.kind === 'contacts' && <div className="bubble-file"><i className="ri-contacts-line" /> {media.names}</div>}

        {m.files.map((f, i) => f.image ? (
          <a key={i} href={f.url} target="_blank" rel="noopener" className="bubble-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} loading="lazy" alt="Attachment" />
          </a>
        ) : (
          <a key={i} href={f.url} target="_blank" rel="noopener" className="bubble-file"><i className="ri-attachment-2" /> <span className="text-truncate">{f.name}</span></a>
        ))}

        {m.rendered && <RenderedTemplateView t={m.rendered} />}
        {m.template && (
          <div className="bubble-template">
            <i className="ri-file-list-3-line" /> {m.template.name}
            {m.template.para && <div className="small text-muted">{m.template.para}</div>}
          </div>
        )}
        {m.html !== null && <div className="bubble-text" dangerouslySetInnerHTML={{ __html: m.html }} />}
        {m.placeholder !== null && <div className="bubble-text text-muted fst-italic">{m.placeholder}</div>}

        <span className="bubble-meta">
          {m.time}
          {m.tick && ' '}
          {m.tick === 'error' && <i className="ri-error-warning-fill text-danger" title={m.status} />}
          {m.tick === 'read' && <i className="ri-check-double-line tick-read" title="Read" />}
          {m.tick === 'delivered' && <i className="ri-check-double-line" title="Delivered" />}
          {m.tick === 'sent' && <i className="ri-check-line" title="Sent" />}
          {m.tick === 'failed' && <i className="ri-close-circle-fill text-danger" title="Failed" />}
          {m.tick === 'pending' && <i className="ri-time-line" title={m.status} />}
        </span>
        {m.failed && <div className="bubble-error">{m.status}</div>}
      </div>
    </div>
  );
}

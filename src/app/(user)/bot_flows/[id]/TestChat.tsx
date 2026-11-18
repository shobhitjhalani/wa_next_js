'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { parseKeywords, type FlowGraph, type TriggerData } from '@/lib/bot-flow';
import type { SessionState, TestInput, TestMessage } from '@/lib/services/bot-flows';
import { waToHtml } from '@/lib/whatsapp-text';
import { runTest } from '../actions';

/**
 * Test chat in the Flow Builder: you play the customer against the flow on screen
 * (saved or not, active or not). Nothing is sent to WhatsApp or stored; webhooks are real.
 */
export function TestChat({ flowId, name, getGraph, onClose }: {
  flowId: number; name: string; getGraph: () => FlowGraph; onClose: () => void;
}) {
  const [items, setItems] = useState<TestMessage[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [text, setText] = useState('');
  const [customer, setCustomer] = useState({ name: 'Test Customer', mobile: '919876543210' });
  const [showSetup, setShowSetup] = useState(false);
  const [showVars, setShowVars] = useState(false);
  const [openList, setOpenList] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, startBusy] = useTransition();
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }); }, [items, busy]);

  const keywords = parseKeywords((getGraph().nodes.find((n) => n.type === 'trigger')?.data as TriggerData | undefined)?.keywords ?? '');
  const running = state?.status === 1;
  const waiting = running && !!state?.waitUntil;
  // Only the newest buttons / list can be answered
  const lastPrompt = items.findLastIndex((m) => m.kind === 'buttons' || m.kind === 'list');
  const answeredAfter = items.slice(lastPrompt + 1).some((m) => m.kind === 'customer');

  const send = (message: TestInput, shown?: string) => {
    if (busy) return;
    setError('');
    setOpenList(null);
    if (shown !== undefined) setItems((xs) => [...xs, { kind: 'customer', text: shown }]);
    startBusy(async () => {
      try {
        const res = await runTest(flowId, { name, graph: getGraph(), state, message, customer });
        setItems((xs) => [...xs, ...res.messages]);
        setState(res.state);
      } catch {
        setError('The test could not run. Check your connection and try again.');
      }
      input.current?.focus();
    });
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    send({ text: t }, t);
  };

  const restart = () => { setItems([]); setState(null); setError(''); setOpenList(null); input.current?.focus(); };
  const vars = Object.entries(state?.vars ?? {}).filter(([k]) => k !== 'trigger');

  return (
    <aside className="fb-inspector fb-test">
      <div className="fb-test-head">
        <span className="fb-test-avatar"><i className="ri-robot-2-line" /></span>
        <div className="flex-grow-1 min-w-0">
          <div className="fw-semibold text-truncate">Test: {name || 'Flow'}</div>
          <div className="small opacity-75">{busy ? 'typing…' : 'Nothing is sent to WhatsApp'}</div>
        </div>
        <button type="button" className="btn btn-sm fb-test-icon" onClick={() => setShowSetup((v) => !v)} title="Test customer"><i className="ri-user-settings-line" /></button>
        <button type="button" className="btn btn-sm fb-test-icon" onClick={restart} title="Start over"><i className="ri-restart-line" /></button>
        <button type="button" className="btn btn-sm fb-test-icon" onClick={onClose} title="Close test" aria-label="Close test"><i className="ri-close-line" /></button>
      </div>

      {showSetup && (
        <div className="fb-test-setup">
          <div className="small text-muted mb-1">Test as — used for {'{{name}}'} and {'{{mobile}}'}</div>
          <div className="d-flex gap-2">
            <input className="form-control form-control-sm" value={customer.name} maxLength={60} placeholder="Name" onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <input className="form-control form-control-sm" value={customer.mobile} maxLength={15} placeholder="Mobile" inputMode="numeric" onChange={(e) => setCustomer({ ...customer, mobile: e.target.value.replace(/\D/g, '') })} />
          </div>
        </div>
      )}

      <div className="fb-chat" ref={body}>
        {!items.length && (
          <div className="fb-chat-intro">
            <i className="ri-chat-smile-2-line fs-2 d-block mb-1" />
            Send a trigger keyword to start, then reply as your customer would. The test uses the flow as it is on screen, also unsaved changes.
            <div className="mt-2 small">Webhooks are called for real.</div>
          </div>
        )}
        {items.map((m, i) => <Bubble key={i} m={m} active={i === lastPrompt && !answeredAfter && running && !busy}
          listOpen={openList === i} onToggleList={() => setOpenList(openList === i ? null : i)}
          onPick={(id, title) => send({ replyId: id, text: title }, title)} />)}
        {busy && <div className="fb-msg fb-bot fb-typing"><span /><span /><span /></div>}
      </div>

      {error && <div className="alert alert-danger small m-2 mb-0 py-2">{error}</div>}
      {vars.length > 0 && (
        <div className="fb-test-vars">
          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => setShowVars((v) => !v)}>
            <i className={showVars ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} /> Saved variables ({vars.length})
          </button>
          {showVars && (
            <div className="mt-1">
              {vars.map(([k, v]) => <div key={k} className="small text-truncate" title={v}><code>{`{{${k}}}`}</code> {v || <span className="text-muted">(empty)</span>}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="fb-test-foot">
        {waiting && (
          <button type="button" className="btn btn-sm btn-soft-warning w-100 mb-2" onClick={() => send({ skipWait: true })} disabled={busy}>
            <i className="ri-skip-forward-line" /> Skip the wait and continue
          </button>
        )}
        {!running && keywords.length > 0 && (
          <div className="d-flex flex-wrap gap-1 mb-2">
            {keywords.slice(0, 6).map((k) => (
              <button key={k} type="button" className="btn btn-sm btn-light border fb-chip" onClick={() => send({ text: k }, k)} disabled={busy}>{k}</button>
            ))}
          </div>
        )}
        <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input ref={input} className="form-control" placeholder={running ? 'Type a reply…' : 'Type a keyword…'} value={text} maxLength={1000}
            onChange={(e) => setText(e.target.value)} autoFocus />
          <button type="submit" className="btn btn-success fb-send" disabled={busy || !text.trim()} aria-label="Send"><i className="ri-send-plane-2-fill" /></button>
        </form>
      </div>
    </aside>
  );
}

function Media({ url }: { url: string | null }) {
  if (!url) return null;
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return <img src={url} alt="" className="fb-msg-img" />;
  return (
    <a href={url} target="_blank" rel="noopener" className="fb-msg-file">
      <i className={/\.(mp4|3gp)(\?|$)/i.test(url) ? 'ri-video-line' : 'ri-file-text-line'} />
      <span className="text-truncate">{decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'File')}</span>
    </a>
  );
}

function Bubble({ m, active, listOpen, onToggleList, onPick }: {
  m: TestMessage; active: boolean; listOpen: boolean; onToggleList: () => void; onPick: (id: string, title: string) => void;
}) {
  switch (m.kind) {
    case 'customer':
      return <div className="fb-msg fb-me">{m.text}</div>;
    case 'note':
      return <div className="fb-note">{m.text}</div>;
    case 'text':
      return (
        <div className="fb-msg fb-bot">
          <Media url={m.media} />
          {m.text && <div dangerouslySetInnerHTML={{ __html: waToHtml(m.text) }} />}
        </div>
      );
    case 'template':
      return (
        <div className="fb-msg fb-bot">
          <div className="fb-msg-tag"><i className="ri-file-text-line" /> Template · {m.name || 'not chosen'}</div>
          <Media url={m.media} />
          {m.text ? <div dangerouslySetInnerHTML={{ __html: waToHtml(m.text) }} /> : <div className="text-muted small">Template text not found — sync templates on the WA Templates page.</div>}
        </div>
      );
    case 'buttons':
      return (
        <div className="fb-msg fb-bot fb-interactive">
          <Media url={m.media} />
          <div dangerouslySetInnerHTML={{ __html: waToHtml(m.text) }} />
          {m.footer && <div className="fb-msg-footer">{m.footer}</div>}
          <div className="fb-msg-actions">
            {m.options.map((o) => (
              <button key={o.id} type="button" disabled={!active} onClick={() => onPick(o.id, o.title)}><i className="ri-reply-line" /> {o.title}</button>
            ))}
          </div>
        </div>
      );
    case 'list':
      return (
        <div className="fb-msg fb-bot fb-interactive">
          <div dangerouslySetInnerHTML={{ __html: waToHtml(m.text) }} />
          {m.footer && <div className="fb-msg-footer">{m.footer}</div>}
          <div className="fb-msg-actions">
            <button type="button" disabled={!active} onClick={onToggleList}><i className="ri-list-unordered" /> {m.button}</button>
          </div>
          {listOpen && active && (
            <div className="fb-list">
              {m.options.map((o) => (
                <button key={o.id} type="button" onClick={() => onPick(o.id, o.title)}>
                  <span className="fw-medium d-block">{o.title}</span>
                  {o.description && <span className="small text-muted d-block">{o.description}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      );
  }
}

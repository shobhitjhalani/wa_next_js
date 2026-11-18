'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { LABEL_COLOR_KEYS, LABEL_COLORS, MAX_LABEL_NAME, type ChatLabel, type LabelColor } from '@/lib/chat-labels';
import { createChatLabel, deleteChatLabel, setChatLabel, updateChatLabel } from './actions';

/** Inbox chat labels: chips on rows / thread header, the Label menu, and colour helpers. */

export const chipStyle = (color: LabelColor) => ({ '--lb': LABEL_COLORS[color][0], '--lb-bg': LABEL_COLORS[color][1] }) as CSSProperties;

/** Label chips of a chat (`max` shown, the rest as +n). */
export function LabelChips({ ids, labels, max = 3, small }: { ids: number[]; labels: Map<number, ChatLabel>; max?: number; small?: boolean }) {
  const list = ids.map((id) => labels.get(id)).filter((l): l is ChatLabel => !!l);
  if (!list.length) return null;
  return (
    <span className={`chat-labels${small ? ' small' : ''}`}>
      {list.slice(0, max).map((l) => <span key={l.id} className="chat-label" style={chipStyle(l.color)} title={l.name}>{l.name}</span>)}
      {list.length > max && <span className="chat-label more" title={list.slice(max).map((l) => l.name).join(', ')}>+{list.length - max}</span>}
    </span>
  );
}

function ColorPicker({ value, onChange }: { value: LabelColor; onChange: (c: LabelColor) => void }) {
  return (
    <div className="label-colors" role="radiogroup" aria-label="Label colour">
      {LABEL_COLOR_KEYS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c} title={c}
          className={c === value ? 'on' : ''} style={{ background: LABEL_COLORS[c][0] }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

/**
 * "Label" button in the thread header: tick labels for this chat, create a new one
 * (put on the chat at once), rename / recolour / delete labels.
 */
export function LabelMenu({ mobile, chat, labels, disabled, onLabels, onChat }: {
  mobile: string; chat: number[]; labels: ChatLabel[]; disabled?: boolean;
  onLabels: (labels: ChatLabel[]) => void; onChat: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('green');
  const [editing, setEditing] = useState<{ id: number; name: string; color: LabelColor } | null>(null);
  const [error, setError] = useState('');
  const [busy, startBusy] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { setOpen(false); setEditing(null); setError(''); }, [mobile]);

  const run = (fn: () => Promise<void>) => { setError(''); startBusy(fn); };
  const toggle = (id: number, on: boolean) => run(async () => {
    const res = await setChatLabel(mobile, id, on);
    if (!res.ok) { setError(res.error); return; }
    onLabels(res.labels);
    onChat(res.chat);
  });
  const create = () => run(async () => {
    const res = await createChatLabel(name, color, mobile);
    if (!res.ok) { setError(res.error); return; }
    onLabels(res.labels);
    onChat([...chat, res.id]);
    setName('');
  });
  const saveEdit = () => editing && run(async () => {
    const res = await updateChatLabel(editing.id, editing.name, editing.color);
    if (!res.ok) { setError(res.error); return; }
    onLabels(res.labels);
    setEditing(null);
  });
  const remove = (l: ChatLabel) => {
    if (!window.confirm(`Delete the label “${l.name}”? It is removed from ${l.count} chat${l.count === 1 ? '' : 's'}.`)) return;
    run(async () => {
      const res = await deleteChatLabel(l.id);
      if (!res.ok) { setError(res.error); return; }
      onLabels(res.labels);
      onChat(chat.filter((id) => id !== l.id));
    });
  };

  return (
    <div className="label-menu" ref={root}>
      <button type="button" className={`btn btn-sm ${chat.length ? 'btn-soft-primary' : 'btn-light'}`} disabled={disabled} onClick={() => setOpen((v) => !v)}
        title={disabled ? 'Labels can be added once this number has a conversation' : 'Label this chat'} aria-expanded={open}>
        <i className="ri-price-tag-3-line" /> <span className="d-none d-sm-inline">Label</span>
      </button>
      {open && (
        <div className="label-panel shadow">
          <div className="label-panel-head">Label this chat</div>
          <div className="label-list">
            {!labels.length && <div className="text-muted small px-3 py-2">No labels yet — create your first one below.</div>}
            {labels.map((l) => editing?.id === l.id ? (
              <div key={l.id} className="label-edit">
                <input className="form-control form-control-sm" value={editing.name} maxLength={MAX_LABEL_NAME} autoFocus
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } }} />
                <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                <div className="d-flex gap-1 justify-content-end">
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={saveEdit} disabled={busy || !editing.name.trim()}>Save</button>
                </div>
              </div>
            ) : (
              <div key={l.id} className="label-row">
                <label className="label-check">
                  <input type="checkbox" className="form-check-input" checked={chat.includes(l.id)} disabled={busy} onChange={(e) => toggle(l.id, e.target.checked)} />
                  <span className="chat-label" style={chipStyle(l.color)}>{l.name}</span>
                  <span className="text-muted small ms-auto">{l.count}</span>
                </label>
                <button type="button" className="btn btn-sm btn-link text-muted p-0 ms-2" title="Rename / colour" aria-label={`Edit ${l.name}`}
                  onClick={() => setEditing({ id: l.id, name: l.name, color: l.color })}><i className="ri-pencil-line" /></button>
                <button type="button" className="btn btn-sm btn-link text-muted p-0 ms-1 label-del" title="Delete label" aria-label={`Delete ${l.name}`}
                  onClick={() => remove(l)}><i className="ri-delete-bin-line" /></button>
              </div>
            ))}
          </div>
          <form className="label-new" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <div className="small fw-medium mb-1">New label</div>
            <div className="d-flex gap-1">
              <input className="form-control form-control-sm" placeholder="e.g. Hot lead" value={name} maxLength={MAX_LABEL_NAME} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn btn-sm btn-success" disabled={busy || !name.trim()}><i className="ri-add-line" /></button>
            </div>
            <ColorPicker value={color} onChange={setColor} />
          </form>
          {error && <div className="text-danger small px-3 pb-2">{error}</div>}
        </div>
      )}
    </div>
  );
}

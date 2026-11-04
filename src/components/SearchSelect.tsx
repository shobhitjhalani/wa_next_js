'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Searchable single-select (combobox): a button showing the choice, opening a
 * panel with a filter box and a keyboard-navigable list. Submits `value`
 * through a hidden input when `name` is set.
 */

export interface SearchOption { value: string; label: string }

export function SearchSelect({ id, name, options, value, onChange, placeholder = 'Select', searchPlaceholder = 'Search…', emptyText = 'No matches', disabled, required }: {
  id?: string;
  name?: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const auto = useId();
  const listId = (id ?? auto) + '_list';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? options.filter((o) => terms.every((t) => o.label.toLowerCase().includes(t))) : options;
  }, [options, q]);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function show() {
    if (disabled) return;
    setQ('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function choose(o: SearchOption | undefined) {
    if (!o) return;
    setOpen(false);
    button.current?.focus();
    if (o.value !== value) onChange(o.value);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div className={`search-select${open ? ' open' : ''}`} ref={root}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button" id={id} ref={button} className="form-select text-start text-truncate" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-required={required}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); show(); } }}
      >
        {selected ? selected.label : <span className="text-muted">{placeholder}</span>}
      </button>
      {open && (
        <div className="search-select-panel shadow">
          <div className="search-select-search">
            <i className="ri-search-line" aria-hidden="true" />
            <input
              ref={search} type="search" className="form-control form-control-sm" placeholder={searchPlaceholder} value={q}
              role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${listId}_${active}` : undefined}
              onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            />
          </div>
          <ul className="search-select-list" role="listbox" id={listId} ref={list}>
            {shown.map((o, i) => (
              <li
                key={o.value} id={`${listId}_${i}`} data-index={i} role="option" aria-selected={o.value === value}
                className={`${i === active ? 'active' : ''}${o.value === value ? ' selected' : ''}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
              >
                <span className="text-truncate">{o.label}</span>
                {o.value === value && <i className="ri-check-line ms-auto" aria-hidden="true" />}
              </li>
            ))}
            {!shown.length && <li className="search-select-empty" aria-disabled="true">{emptyText}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

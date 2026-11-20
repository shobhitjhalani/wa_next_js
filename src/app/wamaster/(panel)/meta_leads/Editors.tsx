'use client';

import { useRef, useState, useTransition } from 'react';
import {
  CITY_RADIUS_KM, RADIUS_KM, STANDARD_QUESTIONS, locationLabel, parseLatLng,
  type FoundLocation, type Question, type TargetLocation,
} from '@/lib/meta-ad-form';
import { searchPlaces } from './actions';

// ------------------------------------------------------------------ questions

interface Row { id: number; q: Question; answers: string }

let nextId = 1;
const toRow = (q: Question): Row => ({ id: nextId++, q, answers: Array.isArray(q.options) ? q.options.map((o) => o.value).join('\n') : '' });

/** Row → Meta question (existing keys kept; new ones are made from the text when saved). */
function toQuestion(r: Row): Question {
  if (r.q.type !== 'CUSTOM') {
    const { type, ...rest } = r.q;
    delete rest.label; delete rest.options; delete rest.key;
    return { type, ...rest };
  }
  const keyOf = new Map((r.q.options ?? []).map((o) => [o.value, o.key]));
  const answers = r.answers.split('\n').map((x) => x.trim()).filter(Boolean);
  const out: Question = { ...r.q, label: (r.q.label ?? '').trim() };
  if (answers.length) out.options = answers.map((value) => ({ value, key: keyOf.get(value) ?? '' }));
  else delete out.options;
  return out;
}

/** The lead form's questions: Meta's prefilled fields and your own (free text or multiple choice). Posts JSON as `name`. */
export function QuestionsEditor({ name = 'questions', initial }: { name?: string; initial: Question[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const set = (id: number, f: (r: Row) => Row) => setRows((rs) => rs.map((r) => (r.id === id ? f(r) : r)));
  const move = (i: number, d: number) => setRows((rs) => {
    const j = i + d;
    if (j < 0 || j >= rs.length) return rs;
    const out = [...rs];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });
  const used = new Set(rows.map((r) => r.q.type));
  const firstFree = STANDARD_QUESTIONS.find((s) => !used.has(s.type))?.type ?? 'EMAIL';

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(rows.map(toQuestion))} />
      {rows.length === 0 && <div className="text-muted small mb-2">No questions yet.</div>}
      <ol className="list-unstyled mb-2">
        {rows.map((r, i) => {
          const custom = r.q.type === 'CUSTOM';
          const known = custom || STANDARD_QUESTIONS.some((s) => s.type === r.q.type);
          return (
            <li key={r.id} className="border rounded p-2 mb-2 bg-light-subtle">
              <div className="d-flex gap-2 align-items-start">
                <span className="badge bg-secondary-subtle text-secondary mt-2">{i + 1}</span>
                <div className="flex-grow-1">
                  <div className="row g-2">
                    <div className={custom ? 'col-md-4' : 'col-md-6'}>
                      <select className="form-select form-select-sm" aria-label={`Question ${i + 1} type`} value={r.q.type}
                        onChange={(e) => set(r.id, (x) => ({ ...x, q: { ...x.q, type: e.target.value } }))}>
                        <optgroup label="Prefilled by Meta">
                          {STANDARD_QUESTIONS.map((s) => <option key={s.type} value={s.type} disabled={s.type !== r.q.type && used.has(s.type)}>{s.label}</option>)}
                          {!known && <option value={r.q.type}>{r.q.type}</option>}
                        </optgroup>
                        <option value="CUSTOM">Your own question…</option>
                      </select>
                    </div>
                    {custom && (
                      <div className="col-md-8">
                        <input className="form-control form-control-sm" placeholder="The question, e.g. What is your budget?" maxLength={200}
                          aria-label={`Question ${i + 1} text`} value={r.q.label ?? ''}
                          onChange={(e) => set(r.id, (x) => ({ ...x, q: { ...x.q, label: e.target.value } }))} />
                      </div>
                    )}
                    {custom && (
                      <div className="col-12">
                        <textarea className="form-control form-control-sm" rows={Math.min(6, Math.max(2, r.answers.split('\n').length))}
                          placeholder={'Answers to choose from, one per line (e.g. Under 10 lakh ↵ 10–25 lakh).\nEmpty = the person types the answer.'}
                          aria-label={`Question ${i + 1} answers`} value={r.answers}
                          onChange={(e) => set(r.id, (x) => ({ ...x, answers: e.target.value }))} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="btn-group btn-group-sm">
                  <button type="button" className="btn btn-soft-secondary" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><i className="ri-arrow-up-line" /></button>
                  <button type="button" className="btn btn-soft-secondary" title="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><i className="ri-arrow-down-line" /></button>
                  <button type="button" className="btn btn-soft-danger" title="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><i className="ri-delete-bin-line" /></button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="d-flex gap-2">
        <button type="button" className="btn btn-sm btn-soft-primary" disabled={rows.length >= 15}
          onClick={() => setRows((rs) => [...rs, toRow({ type: firstFree })])}><i className="ri-add-line" /> Prefilled field</button>
        <button type="button" className="btn btn-sm btn-soft-primary" disabled={rows.length >= 15}
          onClick={() => setRows((rs) => [...rs, toRow({ type: 'CUSTOM', label: '' })])}><i className="ri-question-line" /> Own question</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ target area

const TYPE_LABEL: Record<FoundLocation['type'], string> = { city: 'City', region: 'State / region', zip: 'PIN code' };

/** Local places: search Meta's cities / states / PIN codes, or a radius around a point. Posts JSON as `name`. */
export function AreaEditor({ name = 'locations', initial }: { name?: string; initial: TargetLocation[] }) {
  const [places, setPlaces] = useState<TargetLocation[]>(initial);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('IN');
  const [found, setFound] = useState<FoundLocation[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, startSearch] = useTransition();
  const [pin, setPin] = useState({ name: '', coords: '', km: '5' });
  const [pinError, setPinError] = useState('');
  const searchBox = useRef<HTMLInputElement>(null);

  const has = (t: string, key: string) => places.some((p) => p.type === t && 'key' in p && p.key === key);
  const search = () => {
    setSearchError('');
    startSearch(async () => {
      const r = await searchPlaces(q, country);
      setFound(r.results);
      setSearchError(r.error);
    });
  };
  const addPin = () => {
    const ll = parseLatLng(pin.coords);
    const km = Math.round(Number(pin.km));
    if (!ll) return setPinError('Paste coordinates like 19.0760, 72.8777 or a Google Maps link.');
    if (!(km >= RADIUS_KM.min && km <= RADIUS_KM.max)) return setPinError(`The radius must be ${RADIUS_KM.min}–${RADIUS_KM.max} km.`);
    setPlaces((p) => [...p, { type: 'radius', name: pin.name.trim() || `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`, lat: ll.lat, lng: ll.lng, km }]);
    setPin({ name: '', coords: '', km: pin.km });
    setPinError('');
  };
  const noEnter = (f: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); f(); } };

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(places)} />
      <div className="d-flex flex-wrap gap-2 mb-2">
        {places.length === 0 && <span className="text-muted small">No local places: the whole of the countries above is targeted.</span>}
        {places.map((p, i) => (
          <span key={`${p.type}-${i}`} className="badge bg-primary-subtle text-primary fs-6 fw-normal d-inline-flex align-items-center gap-1 py-1">
            <i className={p.type === 'radius' ? 'ri-map-pin-range-line' : p.type === 'city' ? 'ri-building-2-line' : 'ri-map-2-line'} />
            {p.type === 'city' ? p.name : locationLabel(p)}
            {p.type === 'city' && (
              <select className="form-select form-select-sm py-0 ms-1" style={{ width: 'auto', fontSize: '.75rem' }} aria-label={`Radius around ${p.name}`}
                value={p.km ?? ''} onChange={(e) => setPlaces((ps) => ps.map((x, j) => (j === i && x.type === 'city' ? { ...x, km: Number(e.target.value) || undefined } : x)))}>
                <option value="">city only</option>
                {[17, 25, 40, 50, 65, 80].map((k) => <option key={k} value={k}>+{k} km</option>)}
              </select>
            )}
            <button type="button" className="btn btn-link btn-sm p-0 ms-1 text-danger" aria-label="Remove" onClick={() => setPlaces((ps) => ps.filter((_, j) => j !== i))}><i className="ri-close-line" /></button>
          </span>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="small fw-semibold mb-1">Add a city, state or PIN code</div>
          <div className="input-group input-group-sm">
            <input className="form-control" style={{ maxWidth: 56 }} value={country} maxLength={2} aria-label="Country code" title="Country (two letters)"
              onChange={(e) => setCountry(e.target.value.toUpperCase())} />
            <input ref={searchBox} className="form-control" placeholder="e.g. Pune, Maharashtra, 411001" value={q} aria-label="Search places"
              onChange={(e) => setQ(e.target.value)} onKeyDown={noEnter(search)} />
            <button type="button" className="btn btn-soft-primary" onClick={search} disabled={searching || q.trim().length < 2}>
              {searching ? <span className="spinner-border spinner-border-sm" /> : <i className="ri-search-line" />} Search
            </button>
          </div>
          {searchError && <div className="small text-danger mt-1">{searchError}</div>}
          {found && !searchError && (
            found.length === 0 ? <div className="small text-muted mt-1">Nothing found.</div> : (
              <ul className="list-group list-group-flush border rounded mt-1" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {found.map((f) => (
                  <li key={`${f.type}-${f.key}`} className="list-group-item py-1 px-2 d-flex justify-content-between align-items-center small">
                    <span><b>{f.name}</b> <span className="text-muted">{TYPE_LABEL[f.type]}{f.detail ? ` · ${f.detail}` : ''}</span></span>
                    <button type="button" className="btn btn-sm btn-link p-0" disabled={has(f.type, f.key)}
                      onClick={() => { setPlaces((p) => [...p, { type: f.type, key: f.key, name: f.detail ? `${f.name}, ${f.detail.split(',')[0]}` : f.name }]); searchBox.current?.focus(); }}>
                      {has(f.type, f.key) ? 'Added' : <><i className="ri-add-line" /> Add</>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
        <div className="col-lg-6">
          <div className="small fw-semibold mb-1">Add a radius around a place</div>
          <div className="input-group input-group-sm mb-1">
            <input className="form-control" placeholder="Name, e.g. Andheri showroom" value={pin.name} maxLength={120} aria-label="Place name"
              onChange={(e) => setPin({ ...pin, name: e.target.value })} onKeyDown={noEnter(addPin)} />
            <input className="form-control" style={{ maxWidth: 70 }} type="number" min={RADIUS_KM.min} max={RADIUS_KM.max} value={pin.km} aria-label="Radius in km"
              onChange={(e) => setPin({ ...pin, km: e.target.value })} onKeyDown={noEnter(addPin)} />
            <span className="input-group-text">km</span>
          </div>
          <div className="input-group input-group-sm">
            <input className="form-control" placeholder="Coordinates (19.1197, 72.8468) or a Google Maps link" value={pin.coords} aria-label="Coordinates"
              onChange={(e) => { setPin({ ...pin, coords: e.target.value }); setPinError(''); }} onKeyDown={noEnter(addPin)} />
            <button type="button" className="btn btn-soft-primary" onClick={addPin} disabled={!pin.coords.trim()}><i className="ri-map-pin-add-line" /> Add</button>
          </div>
          {pinError ? <div className="small text-danger mt-1">{pinError}</div> : (
            <div className="form-text">In <a href="https://www.google.com/maps" target="_blank" rel="noreferrer">Google Maps</a>, right-click the spot and click the numbers to copy them. {RADIUS_KM.min}–{RADIUS_KM.max} km.</div>
          )}
        </div>
      </div>
      <div className="form-text">Places are matched on where people live or were recently. A city&apos;s “+ km” must be {CITY_RADIUS_KM.min}–{CITY_RADIUS_KM.max} km (Meta&apos;s limit).</div>
    </div>
  );
}

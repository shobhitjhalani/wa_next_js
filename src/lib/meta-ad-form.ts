/**
 * Meta Lead Ads: lead form questions and the local target area (radius around a point, cities, regions, PIN codes).
 * Pure and client-safe (used by the admin editors, the server actions, provisioning and the tests).
 */

// ------------------------------------------------------------------ questions

export interface QuestionOption { key: string; value: string }
export interface Question { type: string; key?: string; label?: string; options?: QuestionOption[]; [extra: string]: unknown }

/** Meta's standard (prefilled) question types, with a label for the editor. */
export const STANDARD_QUESTIONS: { type: string; label: string }[] = [
  { type: 'FULL_NAME', label: 'Full name' }, { type: 'FIRST_NAME', label: 'First name' }, { type: 'LAST_NAME', label: 'Last name' },
  { type: 'EMAIL', label: 'Email' }, { type: 'PHONE', label: 'Phone number' }, { type: 'CITY', label: 'City' },
  { type: 'STATE', label: 'State' }, { type: 'ZIP', label: 'PIN / ZIP code' }, { type: 'STREET_ADDRESS', label: 'Street address' },
  { type: 'COMPANY_NAME', label: 'Company name' }, { type: 'JOB_TITLE', label: 'Job title' }, { type: 'WORK_EMAIL', label: 'Work email' },
  { type: 'DATE_OF_BIRTH', label: 'Date of birth' }, { type: 'GENDER', label: 'Gender' },
];

/** "Your budget?" → "your_budget" (Meta keys: letters, digits, underscore). */
export function slugKey(text: string, max = 40): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max).replace(/_+$/, '') || 'q';
}

/** Give every custom question and option a key (from its label), unique within the form. */
export function withKeys(questions: Question[]): Question[] {
  const used = new Set<string>();
  const unique = (base: string) => { let k = base, n = 2; while (used.has(k)) k = `${base}_${n++}`; used.add(k); return k; };
  return questions.map((q) => {
    if (q.type !== 'CUSTOM') return q;
    const out: Question = { ...q, key: unique(q.key?.trim() || slugKey(q.label ?? '')) };
    if (Array.isArray(q.options) && q.options.length) {
      const optUsed = new Set<string>();
      out.options = q.options.map((o) => {
        let k = o.key?.trim() || slugKey(o.value, 30), n = 2;
        while (optUsed.has(k)) k = `${o.key?.trim() || slugKey(o.value, 30)}_${n++}`;
        optUsed.add(k);
        return { key: k, value: o.value };
      });
    } else delete out.options;
    return out;
  });
}

/** What is wrong with a question list ('' = fine). */
export function questionsProblem(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return 'Add at least one question.';
  if (v.length > 15) return 'At most 15 questions.';
  const types = new Set<string>();
  for (const [i, raw] of v.entries()) {
    const q = raw as Question;
    const n = `Question ${i + 1}`;
    if (!q || typeof q !== 'object' || typeof q.type !== 'string' || !q.type) return `${n}: choose a type.`;
    if (q.type === 'CUSTOM') {
      if (!q.label?.trim()) return `${n}: type the question.`;
      if (q.label.length > 200) return `${n}: at most 200 characters.`;
      if (q.options !== undefined) {
        if (!Array.isArray(q.options)) return `${n}: the answers must be a list.`;
        if (q.options.length === 1) return `${n}: give at least 2 answers (or none for a free-text answer).`;
        if (q.options.some((o) => !o || typeof o.value !== 'string' || !o.value.trim())) return `${n}: an answer is empty.`;
      }
    } else {
      if (types.has(q.type)) return `${n}: “${q.type}” is asked twice.`;
      types.add(q.type);
    }
  }
  return '';
}

// ------------------------------------------------------------------ target area

export type TargetLocation =
  | { type: 'radius'; name: string; lat: number; lng: number; km: number }
  | { type: 'city'; key: string; name: string; km?: number }
  | { type: 'region' | 'zip'; key: string; name: string };

export const RADIUS_KM = { min: 1, max: 80 } as const;      // a point: 1–80 km
export const CITY_RADIUS_KM = { min: 17, max: 80 } as const; // a city "+ km around": 10–50 miles

/** "12.9716, 77.5946", a Google Maps link (…/@12.97,77.59,15z or ?q=12.97,77.59) → coordinates. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(t)
    ?? /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i.exec(t)
    ?? /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t)
    ?? /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Keep the valid places (deduplicated, max 200); anything else is dropped. */
export function cleanLocations(v: unknown): TargetLocation[] {
  const out: TargetLocation[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    const l = raw as Record<string, unknown>;
    if (!l || typeof l !== 'object') continue;
    const name = String(l.name ?? '').trim().slice(0, 120);
    if (l.type === 'radius') {
      const lat = Number(l.lat), lng = Number(l.lng), km = Math.round(Number(l.km));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      if (!(km >= RADIUS_KM.min && km <= RADIUS_KM.max)) continue;
      const id = `r:${round(lat, 5)},${round(lng, 5)},${km}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ type: 'radius', name: name || `${round(lat, 4)}, ${round(lng, 4)}`, lat: round(lat, 6), lng: round(lng, 6), km });
    } else if (l.type === 'city' || l.type === 'region' || l.type === 'zip') {
      const key = String(l.key ?? '').trim();
      if (!/^[A-Za-z0-9:_-]{1,40}$/.test(key) || seen.has(`${l.type}:${key}`)) continue;
      seen.add(`${l.type}:${key}`);
      if (l.type === 'city') {
        const km = Math.round(Number(l.km));
        out.push({ type: 'city', key, name: name || key, ...(km >= CITY_RADIUS_KM.min && km <= CITY_RADIUS_KM.max ? { km } : {}) });
      } else out.push({ type: l.type, key, name: name || key });
    }
    if (out.length >= 200) break;
  }
  return out;
}

/** Short text for a place ("Mumbai (city, +20 km)", "5 km around MG Road shop"). */
export function locationLabel(l: TargetLocation): string {
  if (l.type === 'radius') return `${l.km} km around ${l.name}`;
  if (l.type === 'city') return `${l.name}${l.km ? ` +${l.km} km` : ''}`;
  return `${l.name} (${l.type === 'zip' ? 'PIN' : 'state / region'})`;
}

/**
 * The ad set's geo_locations. With local places, only they are targeted (Meta refuses a country together with a
 * place inside it); otherwise the countries.
 */
export function geoLocations(countries: string[], locations: TargetLocation[]): Record<string, unknown> {
  if (!locations.length) return { countries };
  const g: Record<string, unknown[]> = {};
  const add = (k: string, v: unknown) => { (g[k] ??= []).push(v); };
  for (const l of locations) {
    if (l.type === 'radius') add('custom_locations', { latitude: l.lat, longitude: l.lng, radius: l.km, distance_unit: 'kilometer' });
    else if (l.type === 'city') add('cities', l.km ? { key: l.key, radius: l.km, distance_unit: 'kilometer' } : { key: l.key });
    else add(l.type === 'zip' ? 'zips' : 'regions', { key: l.key });
  }
  return { ...g, location_types: ['home', 'recent'] };
}

/** A place found by Meta's location search (GET /search?type=adgeolocation). */
export interface FoundLocation { type: 'city' | 'region' | 'zip'; key: string; name: string; detail: string }

export function foundLocations(data: unknown): FoundLocation[] {
  const out: FoundLocation[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const r = raw as Record<string, unknown>;
    const type = r.type === 'city' || r.type === 'region' || r.type === 'zip' ? r.type : null;
    if (!type || r.key === undefined || r.key === null) continue;
    const detail = [type === 'city' || type === 'zip' ? r.region : '', type === 'zip' ? r.primary_city : '', r.country_name ?? r.country_code]
      .map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
    out.push({ type, key: String(r.key), name: String(r.name ?? r.key), detail });
  }
  return out;
}

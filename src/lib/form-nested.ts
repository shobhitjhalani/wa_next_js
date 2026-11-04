/**
 * PHP-style nested form fields for Server Actions: FormData with names like
 * `cards[0][buttons][1][text]` or `body_parameters[]` → a nested object
 * (what Laravel's $request->input() saw). String values are trimmed (Laravel
 * TrimStrings); empty file inputs become null.
 *
 *   const input = nestedForm(fd);
 *   for (const card of nList(input.cards)) nStr(card, 'body');
 */

export type NestedValue = string | File | null | NestedObject | NestedValue[];
export interface NestedObject { [key: string]: NestedValue }

export function nestedForm(fd: FormData): NestedObject {
  const root: NestedObject = {};
  for (const [name, raw] of fd.entries()) {
    if (name.startsWith('$ACTION')) continue; // React's own action fields
    const m = /^([^[\]]+)((?:\[[^\]]*\])*)$/.exec(name);
    const path = m ? [m[1], ...[...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1])] : [name];
    if (path.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) continue;
    const val: NestedValue = typeof raw === 'string' ? raw.trim() : raw.size > 0 ? raw : null;
    let node: NestedObject | NestedValue[] = root;
    for (let i = 0; i < path.length; i++) {
      const key = path[i];
      const last = i === path.length - 1;
      if (Array.isArray(node)) {
        if (last) node.push(val);
        else {
          const next: NestedObject | NestedValue[] = path[i + 1] === '' ? [] : {};
          node.push(next);
          node = next;
        }
        continue;
      }
      if (last) {
        node[key] = val;
      } else {
        let next = node[key];
        if (next === null || typeof next !== 'object' || next instanceof File) {
          next = path[i + 1] === '' ? [] : {};
          node[key] = next;
        }
        node = next as NestedObject | NestedValue[];
      }
    }
  }
  return root;
}

/** Values of a list-like field (array or {0: …, 1: …}) in key order; [] when absent. */
export function nList(v: NestedValue | undefined): NestedValue[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && !(v instanceof File)) return Object.values(v);
  return [];
}

/** A child object, or {} when absent / not an object. */
export function nObj(v: NestedValue | undefined): NestedObject {
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof File) ? v : {};
}

/** A string field ('' when absent or not a string). */
export function nStr(obj: NestedValue | undefined, key: string): string {
  const v = nObj(obj)[key];
  return typeof v === 'string' ? v : '';
}

/** An uploaded file field, or null. */
export function nFile(obj: NestedValue | undefined, key: string): File | null {
  const v = nObj(obj)[key];
  return v instanceof File ? v : null;
}

/** String values keyed as submitted (e.g. body_example[1], body_example[2]). */
export function nStrings(v: NestedValue | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string') out[i] = x; });
  else for (const [k, x] of Object.entries(nObj(v))) if (typeof x === 'string') out[k] = x;
  return out;
}

/**
 * Readable answers from a WhatsApp Flow submission (nfm_reply response_json).
 * Client-safe (no server imports).
 *
 * Flow Builder names fields "screen_<screen>_<Label>_<position>" and choice
 * options "<n>_<Label>", e.g. {"screen_0_Pickup_Type_1": "0_Self_Drive"} →
 * "Pickup Type: Self Drive". Fields come back in flow order.
 */

export interface FlowAnswer {
  key: string;
  label: string;
  value: string;
}

const FIELD = /^screen_(\d+)_(.+?)(?:_(\d+))?$/;

const words = (s: string) => s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

export function flowLabel(key: string): string {
  if (key === '_raw') return 'Response';
  const m = FIELD.exec(key);
  return words(m ? m[2] : key) || key;
}

function flowValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(flowValue).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  const option = /^\d+_(.+)$/.exec(s);
  return option ? words(option[1]) : s;
}

function order(key: string): [number, number] {
  const m = FIELD.exec(key);
  return m ? [Number(m[1]), m[3] === undefined ? 999 : Number(m[3])] : [999, 999];
}

/** Answers in flow order, without the technical flow_token. */
export function flowAnswers(response: unknown): FlowAnswer[] {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return [];
  return Object.entries(response as Record<string, unknown>)
    .filter(([k]) => k !== 'flow_token')
    .sort(([a], [b]) => {
      const [sa, pa] = order(a);
      const [sb, pb] = order(b);
      return sa - sb || pa - pb || a.localeCompare(b);
    })
    .map(([key, v]) => ({ key, label: flowLabel(key), value: flowValue(v) }));
}

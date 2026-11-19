/**
 * Chatbot flows (Flow Builder): the graph a flow is made of, shared by the
 * builder (client) and the engine (lib/services/bot-flows.ts). Pure, client-safe.
 *
 * A flow starts at its trigger node when an incoming message matches one of the
 * trigger keywords, then runs node by node along the edges. Nodes that need the
 * customer (buttons, list, ask) or a delay (wait) pause the conversation; it
 * continues on the next reply or when the wait is over. Answers are stored in
 * variables ({{name}}) that later messages, templates and webhooks can use.
 */

export type NodeKind = 'trigger' | 'message' | 'media' | 'buttons' | 'mediabuttons' | 'list' | 'template' | 'ask' | 'wait' | 'webhook' | 'end';

export interface TriggerData { keywords: string; match: 'exact' | 'contains' }
export interface MessageData { text: string }
export interface MediaData { url: string; caption: string }
export interface ButtonsData { text: string; mediaUrl: string; footer: string; buttons: string[]; saveAs: string }
export interface ListRow { title: string; description: string }
export interface ListData { text: string; buttonLabel: string; footer: string; rows: ListRow[]; saveAs: string }
export interface TemplateData { template: string; params: string[]; headerUrl: string }
export interface AskData { text: string; saveAs: string; validate: 'any' | 'number' | 'email' | 'phone' | 'date'; error: string }
export interface WaitData { amount: number; unit: 'minutes' | 'hours' | 'days' }
export interface WebhookData { url: string; method: 'POST' | 'GET'; headers: string; body: string; saveAs: string; map: string }
export type EndData = Record<string, never>;

export interface NodeDataMap {
  trigger: TriggerData; message: MessageData; media: MediaData; buttons: ButtonsData; mediabuttons: ButtonsData; list: ListData;
  template: TemplateData; ask: AskData; wait: WaitData; webhook: WebhookData; end: EndData;
}

export interface FlowNode<K extends NodeKind = NodeKind> {
  id: string;
  type: K;
  position: { x: number; y: number };
  /** Every kind's data may also carry `title`: an internal name shown only in the builder, never sent. */
  data: NodeDataMap[K];
}
export interface FlowEdge { id: string; source: string; sourceHandle: string | null; target: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }

/** js_bot_flow.bf_status. Draft: never activated · Paused: switched off after being active. */
export const FLOW_STATUS = { ACTIVE: 1, DRAFT: 2, PAUSED: 3 } as const;
export const FLOW_TABS = [
  { key: 'active', status: FLOW_STATUS.ACTIVE, label: 'Active', icon: 'ri-play-circle-line', badge: 'bg-success' },
  { key: 'paused', status: FLOW_STATUS.PAUSED, label: 'Paused', icon: 'ri-pause-circle-line', badge: 'bg-warning' },
  { key: 'draft', status: FLOW_STATUS.DRAFT, label: 'Draft', icon: 'ri-draft-line', badge: 'bg-secondary' },
] as const;

export const LIMITS = {
  text: 1024, caption: 1024, button: 20, buttons: 3, rowTitle: 24, rowDescription: 72, rows: 10,
  listLabel: 20, footer: 60, nodeTitle: 60, keywords: 500, varName: 40, url: 1000, body: 5000, headers: 2000, map: 2000, params: 20,
};

/** Palette entries: label, short description, icon, group. */
export const NODE_INFO: Record<NodeKind, { label: string; hint: string; icon: string; group: 'Send' | 'Listen' | 'Logic'; tone: string }> = {
  trigger: { label: 'Trigger', hint: 'Start when a keyword matches', icon: 'ri-flashlight-line', group: 'Listen', tone: 'info' },
  message: { label: 'Send message', hint: 'Plain WhatsApp text', icon: 'ri-chat-3-line', group: 'Send', tone: 'success' },
  media: { label: 'Send media', hint: 'Image, video, document or audio', icon: 'ri-attachment-2', group: 'Send', tone: 'warning' },
  buttons: { label: 'Buttons', hint: 'Up to 3 reply buttons', icon: 'ri-checkbox-multiple-line', group: 'Send', tone: 'success' },
  mediabuttons: { label: 'Attachment + Buttons', hint: 'File, message and reply buttons in one', icon: 'ri-file-list-2-line', group: 'Send', tone: 'warning' },
  list: { label: 'List', hint: 'Menu with up to 10 items', icon: 'ri-list-check-2', group: 'Send', tone: 'success' },
  template: { label: 'Send template', hint: 'Approved WhatsApp template', icon: 'ri-file-text-line', group: 'Send', tone: 'primary' },
  ask: { label: 'Ask question', hint: 'Wait for a typed answer', icon: 'ri-question-answer-line', group: 'Listen', tone: 'danger' },
  wait: { label: 'Wait', hint: 'Pause before the next step', icon: 'ri-time-line', group: 'Logic', tone: 'secondary' },
  webhook: { label: 'Webhook', hint: 'Call your URL, save the reply', icon: 'ri-links-line', group: 'Logic', tone: 'dark' },
  end: { label: 'End flow', hint: 'Finish the conversation', icon: 'ri-stop-circle-line', group: 'Logic', tone: 'secondary' },
};

export const PALETTE_ORDER: NodeKind[] = ['message', 'media', 'mediabuttons', 'buttons', 'list', 'template', 'trigger', 'ask', 'wait', 'webhook', 'end'];

export function defaultData<K extends NodeKind>(kind: K): NodeDataMap[K] {
  const d: { [P in NodeKind]: NodeDataMap[P] } = {
    trigger: { keywords: '', match: 'exact' },
    message: { text: '' },
    media: { url: '', caption: '' },
    buttons: { text: '', mediaUrl: '', footer: '', buttons: ['Yes', 'No'], saveAs: '' },
    mediabuttons: { text: '', mediaUrl: '', footer: '', buttons: ['Interested', 'Call me'], saveAs: '' },
    list: { text: '', buttonLabel: 'Choose', footer: '', rows: [{ title: 'Option 1', description: '' }, { title: 'Option 2', description: '' }], saveAs: '' },
    template: { template: '', params: [], headerUrl: '' },
    ask: { text: '', saveAs: '', validate: 'any', error: 'Please send a valid answer.' },
    wait: { amount: 5, unit: 'minutes' },
    webhook: { url: '', method: 'POST', headers: '', body: '', saveAs: '', map: '' },
    end: {} as EndData,
  };
  return structuredClone(d[kind]);
}

/** A new flow: trigger → message → end. */
export function starterGraph(): FlowGraph {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: defaultData('trigger') },
      { id: 'n1', type: 'message', position: { x: 340, y: 0 }, data: { text: 'Hi {{name}}, thanks for your message!' } },
      { id: 'n2', type: 'end', position: { x: 680, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', sourceHandle: null, target: 'n1' },
      { id: 'e2', source: 'n1', sourceHandle: null, target: 'n2' },
    ],
  };
}

/** Output handles of a node: buttons / list have one per option, webhook success / failure, end none. */
export function outputs(node: FlowNode): { id: string | null; label: string }[] {
  switch (node.type) {
    case 'buttons': case 'mediabuttons': return (node.data as ButtonsData).buttons.map((b, i) => ({ id: `o${i}`, label: b || `Button ${i + 1}` }));
    case 'list': return (node.data as ListData).rows.map((r, i) => ({ id: `o${i}`, label: r.title || `Item ${i + 1}` }));
    case 'webhook': return [{ id: 'ok', label: 'Success' }, { id: 'fail', label: 'Failed' }];
    case 'end': return [];
    default: return [{ id: null, label: '' }];
  }
}

/** Keywords of a trigger, lower-cased and trimmed (comma or new-line separated). */
export function parseKeywords(raw: string): string[] {
  return [...new Set(String(raw ?? '').split(/[,\n]/).map((k) => k.trim().toLowerCase()).filter(Boolean))];
}

export const VAR_RE = /^[a-z][a-z0-9_]*$/;
/** Variables every flow has. */
export const BUILTIN_VARS = ['name', 'mobile', 'last_reply', 'flow_name'];

/** Variables a flow defines (answers and webhook results), in node order. */
export function flowVariables(graph: FlowGraph): string[] {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    const d = n.data as Partial<ButtonsData & ListData & AskData & WebhookData>;
    if (d.saveAs) out.add(d.saveAs);
    if (n.type === 'webhook') for (const [name] of parseMap(d.map ?? '')) out.add(name);
  }
  return [...out];
}

/** Webhook response mapping, one "variable = path.to.field" per line. */
export function parseMap(raw: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of String(raw ?? '').split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(\S.*?)\s*$/.exec(line);
    if (m) out.push([m[1].toLowerCase(), m[2]]);
  }
  return out;
}

// ------------------------------------------------------------------ answers

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A typed date as DD-MM-YYYY, or null when it isn't a real calendar date.
 * Accepts 25-12-2026, 25/12/2026, 25.12.2026, 25-12-26, 2026-12-25 and 25 Dec 2026 / Dec 25, 2026.
 */
export function parseAnswerDate(input: string): string | null {
  const v = String(input ?? '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let d: number, m: number, y: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(v))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[- ]?([a-z]{3,9})[- ]?(\d{2}|\d{4})$/.exec(v))) [d, m, y] = [+r[1], MONTHS.indexOf(r[2].slice(0, 3)) + 1, +r[3]];
  else if ((r = /^([a-z]{3,9}) (\d{1,2}) (\d{2}|\d{4})$/.exec(v))) [m, d, y] = [MONTHS.indexOf(r[1].slice(0, 3)) + 1, +r[2], +r[3]];
  else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // 31-02, 29-02 outside leap years
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}

/** The value to save for an answer to an Ask question step, or null when it is not valid. */
export function checkAnswer(kind: AskData['validate'], input: string): string | null {
  const v = String(input ?? '').trim();
  if (v === '') return null;
  switch (kind) {
    case 'number': return /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, '')) ? v : null;
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
    case 'phone': return /^\+?[\d\s-]{8,16}$/.test(v) && v.replace(/\D/g, '').length >= 8 ? v : null;
    case 'date': return parseAnswerDate(v);
    default: return v;
  }
}

// ------------------------------------------------------------------ validation

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const varName = (v: unknown) => str(v, LIMITS.varName).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '');
const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Clean a graph sent by the builder: known node types, fields clamped, dangling edges dropped. */
export function sanitizeGraph(input: unknown): FlowGraph {
  const g = (input && typeof input === 'object' ? input : {}) as { nodes?: unknown[]; edges?: unknown[] };
  const nodes: FlowNode[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(g.nodes) ? g.nodes.slice(0, 200) : []) {
    const r = (raw ?? {}) as Record<string, any>;
    const type = r.type as NodeKind;
    const id = str(r.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
    if (!id || seen.has(id) || !(type in NODE_INFO)) continue;
    seen.add(id);
    const d = (r.data ?? {}) as Record<string, any>;
    const position = { x: num(r.position?.x, -1e5, 1e5, 0), y: num(r.position?.y, -1e5, 1e5, 0) };
    let data: NodeDataMap[NodeKind];
    switch (type) {
      case 'trigger': data = { keywords: str(d.keywords, LIMITS.keywords), match: d.match === 'contains' ? 'contains' : 'exact' }; break;
      case 'message': data = { text: str(d.text, LIMITS.text) }; break;
      case 'media': data = { url: str(d.url, LIMITS.url).trim(), caption: str(d.caption, LIMITS.caption) }; break;
      case 'buttons': case 'mediabuttons': data = {
        text: str(d.text, LIMITS.text), mediaUrl: str(d.mediaUrl, LIMITS.url).trim(), footer: str(d.footer, LIMITS.footer),
        buttons: (Array.isArray(d.buttons) ? d.buttons : []).slice(0, LIMITS.buttons).map((b: unknown) => str(b, LIMITS.button)),
        saveAs: varName(d.saveAs),
      }; break;
      case 'list': data = {
        text: str(d.text, LIMITS.text), buttonLabel: str(d.buttonLabel, LIMITS.listLabel), footer: str(d.footer, LIMITS.footer),
        rows: (Array.isArray(d.rows) ? d.rows : []).slice(0, LIMITS.rows).map((x: any) => ({ title: str(x?.title, LIMITS.rowTitle), description: str(x?.description, LIMITS.rowDescription) })),
        saveAs: varName(d.saveAs),
      }; break;
      case 'template': data = {
        template: str(d.template, 512), headerUrl: str(d.headerUrl, LIMITS.url).trim(),
        params: (Array.isArray(d.params) ? d.params : []).slice(0, LIMITS.params).map((p: unknown) => str(p, LIMITS.text)),
      }; break;
      case 'ask': data = {
        text: str(d.text, LIMITS.text), saveAs: varName(d.saveAs), error: str(d.error, LIMITS.text),
        validate: (['number', 'email', 'phone', 'date'] as const).find((v) => v === d.validate) ?? 'any',
      }; break;
      case 'wait': data = { amount: num(d.amount, 1, 10000, 5), unit: d.unit === 'hours' || d.unit === 'days' ? d.unit : 'minutes' }; break;
      case 'webhook': data = {
        url: str(d.url, LIMITS.url).trim(), method: d.method === 'GET' ? 'GET' : 'POST', headers: str(d.headers, LIMITS.headers),
        body: str(d.body, LIMITS.body), saveAs: varName(d.saveAs), map: str(d.map, LIMITS.map),
      }; break;
      default: data = {} as EndData;
    }
    const title = str(d.title, LIMITS.nodeTitle).replace(/\s+/g, ' ').trim();
    if (title) (data as { title?: string }).title = title;
    nodes.push({ id, type, position, data } as FlowNode);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: FlowEdge[] = [];
  const used = new Set<string>();
  for (const raw of Array.isArray(g.edges) ? g.edges.slice(0, 500) : []) {
    const r = (raw ?? {}) as Record<string, any>;
    const source = byId.get(String(r.source ?? ''));
    const target = byId.get(String(r.target ?? ''));
    if (!source || !target || source.id === target.id || target.type === 'trigger') continue;
    const handle = r.sourceHandle ? String(r.sourceHandle) : null;
    if (!outputs(source).some((o) => o.id === handle)) continue;
    const key = `${source.id}|${handle ?? ''}`; // one edge per output
    if (used.has(key)) continue;
    used.add(key);
    edges.push({ id: str(r.id, 60) || `e_${key}`, source: source.id, sourceHandle: handle, target: target.id });
  }
  return { nodes, edges };
}

/** Problems that stop a flow from being activated (empty = ready). */
export function validateGraph(graph: FlowGraph): string[] {
  const errors: string[] = [];
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) errors.push('A flow needs exactly one Trigger node.');
  else if (!parseKeywords((triggers[0].data as TriggerData).keywords).length) errors.push('Add at least one trigger keyword.');
  if (triggers[0] && !graph.edges.some((e) => e.source === triggers[0].id)) errors.push('Connect the Trigger to the first step.');

  const label = (n: FlowNode) => (n.data as { title?: string }).title ? `${NODE_INFO[n.type].label} “${(n.data as { title?: string }).title}”` : `${NODE_INFO[n.type].label}${'text' in (n.data as object) && (n.data as MessageData).text ? ` “${(n.data as MessageData).text.slice(0, 30)}”` : ''}`;
  for (const n of graph.nodes) {
    const d = n.data as any;
    switch (n.type) {
      case 'message': if (!d.text.trim()) errors.push(`${label(n)}: enter the message text.`); break;
      case 'media': if (!/^https?:\/\//i.test(d.url)) errors.push(`${label(n)}: upload a file or enter its https:// link.`); break;
      case 'mediabuttons':
        if (!/^https?:\/\//i.test(d.mediaUrl)) errors.push(`${label(n)}: upload the attachment or enter its https:// link.`);
      // falls through: message and buttons are checked as for Buttons
      case 'buttons':
        if (!d.text.trim()) errors.push(`${label(n)}: enter the message text.`);
        if (!d.buttons.length || d.buttons.some((b: string) => !b.trim())) errors.push(`${label(n)}: every button needs a title.`);
        if (new Set(d.buttons.map((b: string) => b.trim().toLowerCase())).size !== d.buttons.length) errors.push(`${label(n)}: button titles must be different.`);
        break;
      case 'list':
        if (!d.text.trim()) errors.push(`${label(n)}: enter the message text.`);
        if (!d.buttonLabel.trim()) errors.push(`${label(n)}: enter the menu button label.`);
        if (!d.rows.length || d.rows.some((r: ListRow) => !r.title.trim())) errors.push(`${label(n)}: every item needs a title.`);
        if (new Set(d.rows.map((r: ListRow) => r.title.trim().toLowerCase())).size !== d.rows.length) errors.push(`${label(n)}: item titles must be different.`);
        break;
      case 'template': if (!d.template) errors.push(`${label(n)}: choose a template.`); break;
      case 'ask':
        if (!d.text.trim()) errors.push(`${label(n)}: enter the question.`);
        if (!d.saveAs) errors.push(`${label(n)}: enter a variable name to save the answer in.`);
        break;
      case 'webhook': if (!/^https?:\/\//i.test(d.url)) errors.push(`Webhook: enter a URL starting with https://.`); break;
    }
    if (n.type !== 'trigger' && !graph.edges.some((e) => e.target === n.id)) errors.push(`${label(n)} is not connected to anything before it.`);
  }
  return [...new Set(errors)];
}

/**
 * Files a flow can upload, with WhatsApp's size limit in MB: images 5, video / audio 16,
 * documents 100 (95 here: the web server takes at most 100 MB per request, form data included).
 */
export const UPLOAD_MAX_MB: Record<string, number> = {
  jpg: 5, jpeg: 5, png: 5,
  mp4: 16, '3gp': 16,
  pdf: 95, doc: 95, docx: 95, xls: 95, xlsx: 95, ppt: 95, pptx: 95, txt: 95, csv: 95,
  mp3: 16, ogg: 16, aac: 16, amr: 16, m4a: 16,
};

/** Why a file can't be uploaded to a flow (wrong type or too large), or '' when it can. */
export function uploadProblem(fileName: string, bytes: number): string {
  const ext = (/\.([^.]+)$/.exec(fileName)?.[1] ?? '').toLowerCase();
  const max = UPLOAD_MAX_MB[ext];
  if (!max) return 'Use an image (JPG, PNG), video (MP4), document (PDF, Word, Excel…) or audio file.';
  if (bytes > max * 1024 * 1024) return `This file is ${(bytes / 1048576).toFixed(1)} MB; ${ext.toUpperCase()} files can be at most ${max} MB.`;
  return '';
}

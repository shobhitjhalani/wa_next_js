'use client';

import '@xyflow/react/dist/style.css';
import './builder.css';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  addEdge, Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, MiniMap,
  Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import {
  BUILTIN_VARS, defaultData, FLOW_STATUS, flowVariables, LIMITS, NODE_INFO, outputs, PALETTE_ORDER, parseKeywords, validateGraph,
  type AskData, type ButtonsData, type FlowGraph, type FlowNode, type ListData, type MediaData, type MessageData, type NodeKind,
  type TemplateData, type TriggerData, type WaitData, type WebhookData,
} from '@/lib/bot-flow';
import { saveFlow, stopSessions } from '../actions';
import { TestChat } from './TestChat';
import { CopyFlowButton } from '../FlowCode';

export interface BuilderTemplate { name: string; language: string; header: string; params: number }

const STATUS_LABEL: Record<number, string> = { [FLOW_STATUS.ACTIVE]: 'Active', [FLOW_STATUS.PAUSED]: 'Paused', [FLOW_STATUS.DRAFT]: 'Draft' };
const STATUS_BADGE: Record<number, string> = {
  [FLOW_STATUS.ACTIVE]: 'bg-success-subtle text-success', [FLOW_STATUS.PAUSED]: 'bg-warning-subtle text-warning', [FLOW_STATUS.DRAFT]: 'bg-light text-muted border',
};

type FNode = Node<Record<string, unknown>, NodeKind>;
type Inserter = (text: string) => void;

const toFlow = (g: FlowGraph): { nodes: FNode[]; edges: Edge[] } => ({
  nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as unknown as Record<string, unknown>, deletable: n.type !== 'trigger' })),
  edges: g.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, type: 'flow' })),
});
const toGraph = (nodes: FNode[], edges: Edge[]): FlowGraph => ({
  nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeKind, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data as never })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target })),
});
const asNode = (n: FNode) => ({ id: n.id, type: n.type, position: n.position, data: n.data }) as unknown as FlowNode;

export function FlowBuilder(props: { id: number; initialName: string; initialStatus: number; initialGraph: FlowGraph; templates: BuilderTemplate[]; running: number }) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({ id, initialName, initialStatus, initialGraph, templates, running }: Parameters<typeof FlowBuilder>[0]) {
  const initial = useMemo(() => toFlow(initialGraph), [initialGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState(initialStatus);
  const active = status === FLOW_STATUS.ACTIVE;
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'danger' | 'info'; text: string; problems?: string[] } | null>(null);
  const [saving, startSaving] = useTransition();
  const [search, setSearch] = useState('');
  const [testing, setTesting] = useState(false);
  const flow = useReactFlow<FNode, Edge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  // Unsaved changes: ask before leaving the page
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const variables = useMemo(() => [...BUILTIN_VARS, ...flowVariables(graph).filter((v) => !BUILTIN_VARS.includes(v)), 'webhook_status'], [graph]);
  const problems = useMemo(() => validateGraph(graph), [graph]);
  const hasTrigger = nodes.some((n) => n.type === 'trigger');

  const newId = () => {
    let nid = '';
    do { nid = `n${Date.now().toString(36)}${(counter.current++).toString(36)}`; } while (nodes.some((n) => n.id === nid));
    return nid;
  };

  const addNode = useCallback((kind: NodeKind, at?: { x: number; y: number }) => {
    if (kind === 'trigger' && nodes.some((n) => n.type === 'trigger')) return;
    // Clicked from the palette: to the right of the selected step (connected to its first free output), else after the rightmost step
    const anchor = at ? null : (nodes.find((n) => n.id === selected) ?? [...nodes].sort((a, b) => b.position.x - a.position.x)[0] ?? null);
    let position = at;
    if (!position) {
      position = anchor ? { x: anchor.position.x + 340, y: anchor.position.y } : { x: 0, y: 0 };
      // Below whatever already sits there (cards differ in height)
      const NEW_HEIGHT = 200;
      for (let guard = 0; guard < 50; guard++) {
        const p: { x: number; y: number } = position;
        const hit = nodes.find((n) => Math.abs(n.position.x - p.x) < 290
          && p.y < n.position.y + (n.measured?.height ?? 180) + 30 && n.position.y < p.y + NEW_HEIGHT);
        if (!hit) break;
        position = { x: p.x, y: hit.position.y + (hit.measured?.height ?? 180) + 40 };
      }
    }
    const nid = newId();
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: nid, type: kind, position: position!, data: defaultData(kind) as unknown as Record<string, unknown>, selected: true }]);
    if (anchor && anchor.id === selected && kind !== 'trigger') {
      const free = outputs(asNode(anchor)).find((o) => !edges.some((e) => e.source === anchor.id && (e.sourceHandle ?? null) === o.id));
      if (free) setEdges((es) => [...es, { id: `e${nid}`, source: anchor.id, sourceHandle: free.id, target: nid, type: 'flow' }]);
    }
    setSelected(nid);
    setDirty(true);
    requestAnimationFrame(() => flow.fitView({ nodes: [{ id: nid }], padding: 2, maxZoom: 1, duration: 300 }));
  }, [nodes, edges, selected, flow, setNodes, setEdges]);

  const onConnect = useCallback((c: Connection) => {
    // One connection per output: a new one replaces the old
    setEdges((es) => addEdge({ ...c, id: `e${Date.now().toString(36)}`, type: 'flow' },
      es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))));
    setDirty(true);
  }, [setEdges]);

  const updateData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
    // Outputs removed (fewer buttons / items): drop their connections
    setEdges((es) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return es;
      const handles = new Set(outputs(asNode({ ...node, data: { ...node.data, ...patch } })).map((o) => o.id));
      return es.filter((e) => e.source !== nodeId || handles.has(e.sourceHandle ?? null));
    });
    setDirty(true);
  }, [nodes, setNodes, setEdges]);

  const removeNode = (nodeId: string) => {
    flow.deleteElements({ nodes: [{ id: nodeId }] });
    setSelected(null);
    setDirty(true);
  };

  const save = (activate: boolean) => {
    setNotice(null);
    startSaving(async () => {
      const res = await saveFlow(id, { name, graph: toGraph(flow.getNodes(), flow.getEdges()), active: activate });
      const data = (res.data ?? {}) as { problems?: string[]; status?: number };
      if (res.ok) {
        if (data.status) setStatus(data.status);
        setDirty(false);
        setNotice({ kind: 'success', text: res.message ?? 'Saved.' });
      } else {
        if (data.status) { setStatus(data.status); setDirty(false); }
        setNotice({ kind: 'danger', text: res.error ?? 'Could not save.', problems: data.problems });
      }
    });
  };

  const stop = () => {
    if (!window.confirm('Stop every conversation that is still running in this flow? Customers who answer later start again with a keyword.')) return;
    startSaving(async () => {
      const res = await stopSessions(id);
      setNotice({ kind: 'info', text: res.message ?? 'Stopped.' });
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/x-flow-node') as NodeKind;
    if (!kind || !(kind in NODE_INFO)) return;
    addNode(kind, flow.screenToFlowPosition({ x: e.clientX - 140, y: e.clientY - 30 }));
  };

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const q = search.trim().toLowerCase();
  const groups = (['Send', 'Listen', 'Logic'] as const).map((g) => ({
    group: g,
    kinds: PALETTE_ORDER.filter((k) => NODE_INFO[k].group === g && (!q || `${NODE_INFO[k].label} ${NODE_INFO[k].hint}`.toLowerCase().includes(q))),
  })).filter((g) => g.kinds.length);

  return (
    <div className="fb-shell">
      <div className="fb-top">
        <Link href="/bot_flows" className="btn btn-light btn-icon" title="Back to flows"><i className="ri-arrow-left-line" /></Link>
        <div className="fb-logo"><i className="ri-flow-chart" /></div>
        <div className="fb-title">
          <small className="text-muted">Flow Builder</small>
          <input className="form-control form-control-sm fb-name" value={name} maxLength={150} aria-label="Flow name"
            onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        </div>
        <span className={`badge ${STATUS_BADGE[status] ?? STATUS_BADGE[FLOW_STATUS.DRAFT]} fb-status`}>
          <i className="ri-circle-fill fs-10 me-1" />{STATUS_LABEL[status] ?? 'Draft'}{dirty ? ' · unsaved' : ''}
        </span>
        <div className="ms-auto d-flex flex-wrap gap-2">
          <button type="button" className={`btn ${testing ? 'btn-soft-success' : 'btn-light'}`} onClick={() => setTesting((v) => !v)} aria-pressed={testing}>
            <i className="ri-play-circle-line" /> Test
          </button>
          <CopyFlowButton id={id} className="btn btn-light" label="Copy"
            title={dirty ? 'Copies the last saved version — save first to include your changes' : 'Copy flow — paste it into another account with “Paste flow”'} />
          <Link href={`/bot_flows/${id}/sessions`} className="btn btn-light"><i className="ri-chat-history-line" /> Conversations{running ? ` (${running} running)` : ''}</Link>
          {running > 0 && <button type="button" className="btn btn-light" onClick={stop} disabled={saving} title="Stop running conversations"><i className="ri-stop-circle-line" /></button>}
          {active ? (
            <button type="button" className="btn btn-soft-warning" disabled={saving} onClick={() => {
              if (window.confirm('Pause this flow? It stops answering keywords and conversations in progress stop. Your changes are saved.')) save(false);
            }}><i className="ri-pause-circle-line" /> Pause</button>
          ) : (
            <button type="button" className="btn btn-light" onClick={() => save(false)} disabled={saving}>
              <i className="ri-save-3-line" /> {status === FLOW_STATUS.PAUSED ? 'Save' : 'Save draft'}
            </button>
          )}
          <button type="button" className="btn btn-success" onClick={() => save(true)} disabled={saving}>
            <i className={saving ? 'ri-loader-4-line' : 'ri-check-line'} /> {active ? 'Save' : status === FLOW_STATUS.PAUSED ? 'Resume' : 'Activate'}
          </button>
        </div>
      </div>

      <div className="fb-body">
        <aside className="fb-palette">
          <div className="fb-palette-head">
            <div className="d-flex justify-content-between"><span className="fw-medium">Add a step</span><span className="text-muted">{PALETTE_ORDER.length}</span></div>
            <div className="position-relative mt-2">
              <i className="ri-search-line fb-search-icon" />
              <input className="form-control form-control-sm ps-4" placeholder="Search steps…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="fb-palette-list">
            {groups.map((g) => (
              <div key={g.group}>
                <div className="fb-group">{g.group}</div>
                {g.kinds.map((k) => {
                  const info = NODE_INFO[k];
                  const disabled = k === 'trigger' && hasTrigger;
                  return (
                    <button key={k} type="button" className="fb-item" draggable={!disabled} disabled={disabled}
                      title={disabled ? 'A flow has one trigger' : 'Click or drag onto the canvas'}
                      onDragStart={(e) => { e.dataTransfer.setData('application/x-flow-node', k); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={() => addNode(k)}>
                      <span className={`fb-icon bg-${info.tone}-subtle text-${info.tone}`}><i className={info.icon} /></span>
                      <span className="text-start"><span className="d-block fw-semibold">{info.label}</span><span className="d-block small text-muted">{info.hint}</span></span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="fb-palette-foot">Tip · click or drag a step onto the canvas, then connect the dots.</div>
        </aside>

        <div className="fb-canvas" ref={wrapper} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          {notice && (
            <div className={`alert alert-${notice.kind} fb-notice shadow-sm`} role="alert">
              <button type="button" className="btn-close float-end" aria-label="Close" onClick={() => setNotice(null)} />
              <div className="fw-medium">{notice.text}</div>
              {notice.problems?.length ? <ul className="mb-0 mt-1 small ps-3">{notice.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
            </div>
          )}
          <ReactFlow<FNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type !== 'select' && x.type !== 'dimensions')) setDirty(true); }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === 'remove')) setDirty(true); }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => setSelected(sel.length === 1 ? sel[0].id : null)}
            isValidConnection={(c) => c.source !== c.target && nodes.find((n) => n.id === c.target)?.type !== 'trigger'}
            defaultEdgeOptions={{ type: 'flow', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls position="bottom-right" />
            <MiniMap position="top-right" pannable zoomable className="fb-minimap" nodeColor="var(--vz-success)" style={{ width: 160, height: 100 }} />
          </ReactFlow>
          <div className="fb-hint">Scroll to pan · pinch or Ctrl + scroll to zoom · select a connection and press Delete to remove it</div>
          {!selectedNode && problems.length > 0 && !notice && (
            <div className="fb-checklist small">
              <i className="ri-error-warning-line text-warning me-1" />{problems.length} thing{problems.length === 1 ? '' : 's'} to finish before activating: {problems[0]}
            </div>
          )}
        </div>

        {testing && (
          <TestChat flowId={id} name={name} getGraph={() => toGraph(flow.getNodes(), flow.getEdges())} onClose={() => setTesting(false)} />
        )}
        {!testing && selectedNode && (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            templates={templates}
            variables={variables}
            onChange={(patch) => updateData(selectedNode.id, patch)}
            onDelete={() => removeNode(selectedNode.id)}
            onClose={() => { setSelected(null); setNodes((ns) => ns.map((n) => ({ ...n, selected: false }))); }}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ canvas: nodes

function preview(text: string, max = 90) {
  const t = String(text ?? '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const NodeCard = memo(function NodeCard({ id, type, data, selected }: NodeProps<FNode>) {
  const kind = type as NodeKind;
  const info = NODE_INFO[kind];
  const node = { id, type: kind, position: { x: 0, y: 0 }, data } as unknown as FlowNode;
  const outs = outputs(node);
  const d = data as Record<string, any>;
  const multi = outs.length > 1 || (outs.length === 1 && outs[0].id !== null);

  let body: React.ReactNode = null;
  switch (kind) {
    case 'trigger': {
      const keys = parseKeywords((d as TriggerData).keywords);
      body = (
        <div className="fb-box fb-box-info">
          <div className="fb-box-label">{d.match === 'contains' ? 'When the message contains' : 'When the message is'}</div>
          <div className="fb-mono">{keys.length ? keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4}` : '') : 'Add trigger keyword…'}</div>
        </div>
      );
      break;
    }
    case 'message':
      body = <div className="fb-box fb-box-success">{preview(d.text) || <span className="text-muted">Type your message…</span>}</div>;
      break;
    case 'media':
      body = (
        <div className="fb-box">
          <div className="text-truncate"><i className="ri-attachment-2 me-1" />{d.url ? decodeURIComponent(String(d.url).split('/').pop() ?? '') : <span className="text-muted">Upload a file…</span>}</div>
          {d.caption && <div className="small text-muted mt-1">{preview(d.caption, 60)}</div>}
        </div>
      );
      break;
    case 'buttons':
    case 'list':
      body = <div className="fb-box fb-box-success">{preview(d.text, 70) || <span className="text-muted">Message text…</span>}</div>;
      break;
    case 'template':
      body = (
        <div className="fb-box fb-box-primary">
          <div className="fb-mono">{d.template || 'Choose a template…'}</div>
          {(d.params as string[])?.length > 0 && <div className="small text-muted mt-1">{(d.params as string[]).map((p, i) => `{{${i + 1}}} ${p || '—'}`).join(' · ')}</div>}
        </div>
      );
      break;
    case 'ask':
      body = (
        <div className="fb-box fb-box-danger">
          {preview(d.text, 70) || <span className="text-muted">Your question…</span>}
          <div className="small text-muted mt-1">Saves the answer in {d.saveAs ? <code>{`{{${d.saveAs}}}`}</code> : '…'}</div>
        </div>
      );
      break;
    case 'wait':
      body = <div className="fb-box"><i className="ri-time-line me-1" />Wait {d.amount} {d.amount === 1 ? String(d.unit).replace(/s$/, '') : d.unit}</div>;
      break;
    case 'webhook':
      body = <div className="fb-box fb-box-dark"><span className="badge bg-dark me-1">{d.method}</span><span className="fb-mono small">{preview(d.url, 40) || 'https://…'}</span></div>;
      break;
    case 'end':
      body = <div className="fb-box"><div className="fw-medium">End session</div><div className="small text-muted">Flow completed</div></div>;
      break;
  }

  return (
    <div className={`fb-node${selected ? ' selected' : ''}`}>
      {kind === 'trigger' && <span className="fb-start">START</span>}
      {kind !== 'trigger' && <Handle type="target" position={Position.Left} className="fb-handle" />}
      <div className="fb-node-head">
        <span className={`fb-icon bg-${info.tone}-subtle text-${info.tone}`}><i className={info.icon} /></span>
        <span className="flex-grow-1 min-w-0">
          <span className="d-block fw-semibold text-truncate">{info.label}</span>
          <span className="d-block fb-mono small text-muted">{kind}</span>
        </span>
        <span className="fb-tag">{info.group.toUpperCase()}</span>
      </div>
      <div className="fb-node-body">
        {body}
        {multi && (
          <div className="fb-outs">
            {outs.map((o, i) => (
              <div key={o.id ?? i} className={`fb-out${o.id === 'fail' ? ' fb-out-fail' : ''}`}>
                <span className="text-truncate">{o.label}</span>
                <Handle type="source" id={o.id ?? undefined} position={Position.Right} className="fb-handle fb-handle-row" />
              </div>
            ))}
          </div>
        )}
      </div>
      {!multi && outs.length === 1 && <Handle type="source" position={Position.Right} className="fb-handle" />}
    </div>
  );
});

const NODE_TYPES = Object.fromEntries(PALETTE_ORDER.map((k) => [k, NodeCard]));

// ------------------------------------------------------------------ canvas: edges

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected }: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ strokeWidth: selected ? 2.5 : 1.75, stroke: selected ? 'var(--vz-success)' : 'var(--vz-secondary-color, #878a99)' }} />
      {selected && (
        <EdgeLabelRenderer>
          <button type="button" className="fb-edge-del nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={() => deleteElements({ edges: [{ id }] })} title="Remove connection" aria-label="Remove connection">
            <i className="ri-close-line" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES = { flow: FlowEdge };

// ------------------------------------------------------------------ inspector

function Inspector({ node, templates, variables, onChange, onDelete, onClose }: {
  node: FNode; templates: BuilderTemplate[]; variables: string[];
  onChange: (patch: Record<string, unknown>) => void; onDelete: () => void; onClose: () => void;
}) {
  const kind = node.type as NodeKind;
  const info = NODE_INFO[kind];
  const d = node.data as Record<string, any>;
  const inserter = useRef<Inserter | null>(null);
  const usesVars = !['trigger', 'wait', 'end'].includes(kind);

  return (
    <aside className="fb-inspector">
      <div className="fb-inspector-head">
        <span className={`fb-icon bg-${info.tone}-subtle text-${info.tone}`}><i className={info.icon} /></span>
        <div className="flex-grow-1"><div className="fw-semibold">{info.label}</div><div className="small text-muted">{info.hint}</div></div>
        <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
      </div>
      <div className="fb-inspector-body">
        <Fields kind={kind} d={d} onChange={onChange} inserter={inserter} templates={templates} />
        {usesVars && (
          <div className="mt-3">
            <div className="small text-muted mb-1">Variables — click to insert into the field you were editing</div>
            <div className="d-flex flex-wrap gap-1">
              {variables.map((v) => (
                <button key={v} type="button" className="btn btn-sm btn-light border fb-var" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => inserter.current?.(`{{${v}}}`)}>{`{{${v}}}`}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      {kind !== 'trigger' && (
        <div className="fb-inspector-foot">
          <button type="button" className="btn btn-soft-danger btn-sm" onClick={onDelete}><i className="ri-delete-bin-line" /> Delete step</button>
        </div>
      )}
    </aside>
  );
}

/** Text input / textarea that registers itself as the target of the variable buttons while focused. */
function TextField({ label, value, onChange, inserter, multiline, max, placeholder, help, mono }: {
  label: string; value: string; onChange: (v: string) => void; inserter?: React.RefObject<Inserter | null>;
  multiline?: boolean; max?: number; placeholder?: string; help?: React.ReactNode; mono?: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const focus = () => {
    if (!inserter) return;
    inserter.current = (text) => {
      const el = ref.current;
      const v = el?.value ?? value;
      const start = el?.selectionStart ?? v.length;
      const end = el?.selectionEnd ?? v.length;
      const next = (v.slice(0, start) + text + v.slice(end)).slice(0, max ?? 100000);
      onChange(next);
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); });
    };
  };
  const common = {
    ref, value, maxLength: max, placeholder, onFocus: focus,
    className: `form-control form-control-sm${mono ? ' fb-mono' : ''}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <div className="mb-3">
      <label className="form-label small fw-medium mb-1 d-flex">{label}{max ? <span className="ms-auto text-muted fw-normal">{value.length}/{max}</span> : null}</label>
      {multiline ? <textarea rows={4} {...common} /> : <input type="text" {...common} />}
      {help && <div className="form-text">{help}</div>}
    </div>
  );
}

function SaveAs({ value, onChange, help }: { value: string; onChange: (v: string) => void; help: string }) {
  return (
    <div className="mb-3">
      <label className="form-label small fw-medium mb-1">Save the answer in variable</label>
      <div className="input-group input-group-sm">
        <span className="input-group-text fb-mono">{'{{'}</span>
        <input className="form-control fb-mono" value={value} maxLength={LIMITS.varName} placeholder="e.g. city"
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
        <span className="input-group-text fb-mono">{'}}'}</span>
      </div>
      <div className="form-text">{help}</div>
    </div>
  );
}

function Upload({ label, value, onChange, accept, help }: { label: string; value: string; onChange: (url: string) => void; accept: string; help?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/bot_flows/upload', { method: 'POST', body, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) onChange(data.url);
      else setError(data.message ?? 'Upload failed.');
    } catch {
      setError('Upload failed.');
    }
    setBusy(false);
  };
  const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(value);
  return (
    <div className="mb-3">
      <label className="form-label small fw-medium mb-1">{label}</label>
      {value && (
        <div className="fb-media mb-2">
          {isImage ? <img src={value} alt="" /> : <div className="small text-truncate"><i className="ri-file-line me-1" />{decodeURIComponent(value.split('/').pop() ?? value)}</div>}
          <button type="button" className="btn btn-sm btn-light" onClick={() => onChange('')} title="Remove"><i className="ri-close-line" /></button>
        </div>
      )}
      <input type="file" className="form-control form-control-sm" accept={accept} disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      <input type="url" className="form-control form-control-sm mt-1" placeholder="…or paste a public https:// link" value={value} onChange={(e) => onChange(e.target.value.trim())} />
      {busy && <div className="small text-muted mt-1"><span className="spinner-border spinner-border-sm me-1" />Uploading…</div>}
      {error && <div className="small text-danger mt-1">{error}</div>}
      {help && <div className="form-text">{help}</div>}
    </div>
  );
}

const ASK_ERRORS: Partial<Record<AskData['validate'], string>> = {
  number: 'Please send a number.',
  email: 'Please send a valid email address.',
  phone: 'Please send a valid phone number.',
  date: 'Please send a valid date, e.g. 25-12-2026.',
};

const MEDIA_ACCEPT = '.jpg,.jpeg,.png,.mp4,.3gp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp3,.ogg,.aac,.amr,.m4a';

function Fields({ kind, d, onChange, inserter, templates }: {
  kind: NodeKind; d: Record<string, any>; onChange: (patch: Record<string, unknown>) => void;
  inserter: React.RefObject<Inserter | null>; templates: BuilderTemplate[];
}) {
  switch (kind) {
    case 'trigger': {
      const t = d as TriggerData;
      return (
        <>
          <TextField label="Keywords" value={t.keywords} onChange={(v) => onChange({ keywords: v })} multiline max={LIMITS.keywords}
            placeholder={'hi, hello, menu'} help="Separate keywords with commas. Upper / lower case doesn't matter." />
          <label className="form-label small fw-medium mb-1">Start the flow when</label>
          <div className="form-check">
            <input className="form-check-input" type="radio" id="m_exact" checked={t.match !== 'contains'} onChange={() => onChange({ match: 'exact' })} />
            <label className="form-check-label small" htmlFor="m_exact">the whole message is one of the keywords</label>
          </div>
          <div className="form-check">
            <input className="form-check-input" type="radio" id="m_contains" checked={t.match === 'contains'} onChange={() => onChange({ match: 'contains' })} />
            <label className="form-check-label small" htmlFor="m_contains">the message contains one of the keywords</label>
          </div>
          <div className="alert alert-light border small mt-3 mb-0">A keyword also restarts the flow for someone already in it. Each keyword can belong to one active flow.</div>
        </>
      );
    }
    case 'message': {
      const m = d as MessageData;
      return <TextField label="Message" value={m.text} onChange={(v) => onChange({ text: v })} inserter={inserter} multiline max={LIMITS.text}
        placeholder="Hi {{name}}! How can we help?" help={<>WhatsApp formatting works: *bold*, _italic_, ~strike~.</>} />;
    }
    case 'media': {
      const m = d as MediaData;
      return (
        <>
          <Upload label="File" value={m.url} onChange={(url) => onChange({ url })} accept={MEDIA_ACCEPT} help="Image (JPG/PNG, 5 MB), video (MP4), document or audio (16 MB)." />
          <TextField label="Caption (optional)" value={m.caption} onChange={(v) => onChange({ caption: v })} inserter={inserter} multiline max={LIMITS.caption} />
        </>
      );
    }
    case 'buttons': {
      const b = d as ButtonsData;
      const setButton = (i: number, v: string) => onChange({ buttons: b.buttons.map((x, j) => (j === i ? v : x)) });
      return (
        <>
          <TextField label="Message" value={b.text} onChange={(v) => onChange({ text: v })} inserter={inserter} multiline max={LIMITS.text} />
          <Upload label="Header image / video / document (optional)" value={b.mediaUrl} onChange={(url) => onChange({ mediaUrl: url })} accept=".jpg,.jpeg,.png,.mp4,.pdf" />
          <TextField label="Footer (optional)" value={b.footer} onChange={(v) => onChange({ footer: v })} max={LIMITS.footer} />
          <label className="form-label small fw-medium mb-1">Buttons <span className="text-muted fw-normal">— each one can lead to a different step</span></label>
          {b.buttons.map((x, i) => (
            <div className="input-group input-group-sm mb-1" key={i}>
              <span className="input-group-text">{i + 1}</span>
              <input className="form-control" value={x} maxLength={LIMITS.button} onChange={(e) => setButton(i, e.target.value)} placeholder="Button title" />
              <button type="button" className="btn btn-light border" disabled={b.buttons.length <= 1} onClick={() => onChange({ buttons: b.buttons.filter((_, j) => j !== i) })} title="Remove"><i className="ri-delete-bin-line" /></button>
            </div>
          ))}
          {b.buttons.length < LIMITS.buttons && <button type="button" className="btn btn-sm btn-soft-success mt-1 mb-3" onClick={() => onChange({ buttons: [...b.buttons, ''] })}><i className="ri-add-line" /> Add button</button>}
          <div className="form-text mb-3">Up to 3 buttons, 20 characters each.</div>
          <SaveAs value={b.saveAs} onChange={(v) => onChange({ saveAs: v })} help="Optional: keeps the button the customer chose." />
        </>
      );
    }
    case 'list': {
      const l = d as ListData;
      const setRow = (i: number, patch: Partial<{ title: string; description: string }>) => onChange({ rows: l.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
      return (
        <>
          <TextField label="Message" value={l.text} onChange={(v) => onChange({ text: v })} inserter={inserter} multiline max={LIMITS.text} />
          <TextField label="Menu button label" value={l.buttonLabel} onChange={(v) => onChange({ buttonLabel: v })} max={LIMITS.listLabel} placeholder="Choose" />
          <TextField label="Footer (optional)" value={l.footer} onChange={(v) => onChange({ footer: v })} max={LIMITS.footer} />
          <label className="form-label small fw-medium mb-1">Items <span className="text-muted fw-normal">— each one can lead to a different step</span></label>
          {l.rows.map((r, i) => (
            <div className="border rounded p-2 mb-2" key={i}>
              <div className="input-group input-group-sm mb-1">
                <span className="input-group-text">{i + 1}</span>
                <input className="form-control" value={r.title} maxLength={LIMITS.rowTitle} onChange={(e) => setRow(i, { title: e.target.value })} placeholder="Item title" />
                <button type="button" className="btn btn-light border" disabled={l.rows.length <= 1} onClick={() => onChange({ rows: l.rows.filter((_, j) => j !== i) })} title="Remove"><i className="ri-delete-bin-line" /></button>
              </div>
              <input className="form-control form-control-sm" value={r.description} maxLength={LIMITS.rowDescription} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="Description (optional)" />
            </div>
          ))}
          {l.rows.length < LIMITS.rows && <button type="button" className="btn btn-sm btn-soft-success mb-3" onClick={() => onChange({ rows: [...l.rows, { title: '', description: '' }] })}><i className="ri-add-line" /> Add item</button>}
          <div className="form-text mb-3">Up to 10 items; titles up to 24 characters.</div>
          <SaveAs value={l.saveAs} onChange={(v) => onChange({ saveAs: v })} help="Optional: keeps the item the customer chose." />
        </>
      );
    }
    case 'template': {
      const t = d as TemplateData;
      const tpl = templates.find((x) => x.name === t.template);
      const pick = (nm: string) => {
        const next = templates.find((x) => x.name === nm);
        onChange({ template: nm, params: Array.from({ length: next?.params ?? 0 }, (_, i) => t.params[i] ?? '') });
      };
      const media = tpl && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.header.toUpperCase());
      return (
        <>
          <div className="mb-3">
            <label className="form-label small fw-medium mb-1">Template</label>
            <select className="form-select form-select-sm" value={t.template} onChange={(e) => pick(e.target.value)}>
              <option value="">Choose an approved template…</option>
              {t.template && !tpl && <option value={t.template}>{t.template} (not approved)</option>}
              {templates.map((x) => <option key={x.name} value={x.name}>{x.name}{x.language ? ` (${x.language})` : ''}</option>)}
            </select>
            {!templates.length && <div className="form-text text-danger">No approved templates — sync them on the WA Templates page.</div>}
          </div>
          {t.params.map((p, i) => (
            <TextField key={i} label={`Value for {{${i + 1}}}`} value={p} inserter={inserter} max={LIMITS.text}
              onChange={(v) => onChange({ params: t.params.map((x, j) => (j === i ? v : x)) })} placeholder="Text or {{variable}}" />
          ))}
          {media && <Upload label={`Header ${tpl!.header.toLowerCase()}`} value={t.headerUrl} onChange={(url) => onChange({ headerUrl: url })}
            accept={tpl!.header.toUpperCase() === 'IMAGE' ? '.jpg,.jpeg,.png' : tpl!.header.toUpperCase() === 'VIDEO' ? '.mp4' : '.pdf'} />}
          <div className="alert alert-light border small mb-0">Templates can be sent at any time, also after a long Wait. Each one counts against your template limit.</div>
        </>
      );
    }
    case 'ask': {
      const a = d as AskData;
      return (
        <>
          <TextField label="Question" value={a.text} onChange={(v) => onChange({ text: v })} inserter={inserter} multiline max={LIMITS.text} placeholder="What is your name?" />
          <SaveAs value={a.saveAs} onChange={(v) => onChange({ saveAs: v })} help="Use it later as {{variable}} in messages, templates and webhooks." />
          <div className="mb-3">
            <label className="form-label small fw-medium mb-1">Accept</label>
            <select className="form-select form-select-sm" value={a.validate} onChange={(e) => {
              const kind = e.target.value as AskData['validate'];
              // A message you wrote yourself is kept; the default ones follow the chosen check
              const standard = !a.error || a.error === 'Please send a valid answer.' || Object.values(ASK_ERRORS).includes(a.error);
              onChange({ validate: kind, ...(standard ? { error: ASK_ERRORS[kind] ?? 'Please send a valid answer.' } : {}) });
            }}>
              <option value="any">Any text</option>
              <option value="number">A number</option>
              <option value="email">An email address</option>
              <option value="phone">A phone number</option>
              <option value="date">A date</option>
            </select>
            {a.validate === 'date' && <div className="form-text">Customers can type 25-12-2026, 25/12/2026, 2026-12-25 or 25 Dec 2026; it is saved as DD-MM-YYYY.</div>}
          </div>
          {a.validate !== 'any' && <TextField label="Message for an invalid answer" value={a.error} onChange={(v) => onChange({ error: v })} inserter={inserter} max={LIMITS.text} help="The question waits for a valid answer (3 tries)." />}
        </>
      );
    }
    case 'wait': {
      const w = d as WaitData;
      return (
        <>
          <label className="form-label small fw-medium mb-1">Wait for</label>
          <div className="input-group input-group-sm mb-3">
            <input type="number" min={1} max={10000} className="form-control" value={w.amount} onChange={(e) => onChange({ amount: Math.max(1, Math.min(10000, Number(e.target.value) || 1)) })} />
            <select className="form-select" value={w.unit} onChange={(e) => onChange({ unit: e.target.value })}>
              <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
            </select>
          </div>
          <div className="alert alert-warning small mb-0">WhatsApp allows normal messages only within 24 hours of the customer's last message. After a longer wait, continue with a <b>Send template</b> step.</div>
        </>
      );
    }
    case 'webhook': {
      const w = d as WebhookData;
      return (
        <>
          <div className="mb-3">
            <label className="form-label small fw-medium mb-1">Request</label>
            <div className="input-group input-group-sm">
              <select className="form-select fb-method" value={w.method} onChange={(e) => onChange({ method: e.target.value })}>
                <option>POST</option><option>GET</option>
              </select>
              <input className="form-control fb-mono" value={w.url} maxLength={LIMITS.url} placeholder="https://example.com/hook?mobile={{mobile}}"
                onChange={(e) => onChange({ url: e.target.value })} onFocus={() => {
                  inserter.current = (text) => onChange({ url: (w.url + text).slice(0, LIMITS.url) });
                }} />
            </div>
          </div>
          <TextField label="Headers (optional)" value={w.headers} onChange={(v) => onChange({ headers: v })} inserter={inserter} multiline max={LIMITS.headers} mono placeholder={'Authorization: Bearer abc123'} help="One per line: Name: value" />
          {w.method === 'POST' && (
            <TextField label="JSON body (optional)" value={w.body} onChange={(v) => onChange({ body: v })} inserter={inserter} multiline max={LIMITS.body} mono
              placeholder={'{"mobile": "{{mobile}}", "city": "{{city}}"}'}
              help={<>Empty sends <code>{'{"flow", "mobile", "name", "variables": {…}}'}</code> with every saved answer.</>} />
          )}
          <SaveAs value={w.saveAs} onChange={(v) => onChange({ saveAs: v })} help="Optional: keeps the whole response." />
          <TextField label="Save fields of the JSON response (optional)" value={w.map} onChange={(v) => onChange({ map: v })} multiline max={LIMITS.map} mono
            placeholder={'order_status = data.status\nagent = data.agents.0.name'} help="One per line: variable = path.in.response" />
          <div className="alert alert-light border small mb-0">Connect <b>Success</b> (HTTP 2xx) and <b>Failed</b> to the next steps. The status code is saved in <code>{'{{webhook_status}}'}</code>. Timeout: 10 seconds.</div>
        </>
      );
    }
    default:
      return <p className="small text-muted mb-0">The conversation ends here. The customer can start again with a trigger keyword.</p>;
  }
}

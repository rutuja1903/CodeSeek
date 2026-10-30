import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Icon from './ui/Icon';
import { Banner, LoadingState, EmptyState } from './ui/ui';
import '../index.css';

// SVG markers cannot resolve CSS variables, so graph colours mirror the design tokens here
const GRAPH_COLORS = {
  canvas: '#0b0e13',
  dots: '#1f2531',
  node: '#161b24',
  nodeSelected: '#1d2330',
  border: '#2b3342',
  text: '#e6eaf1',
  muted: '#8f99ab',
  edge: '#3b4a66',
  accent: '#5b9bff',
  warning: '#f5b544',
  danger: '#f47174',
};

const H_GAP = 280;
const V_GAP = 64;

// --- Layout: layered left-to-right by dependency depth ---
// Edges point from importer/caller to dependency/callee, so sources sit on the left.
// Back edges (from cycles) are ignored for layering only; they are still drawn.
function computeLayeredPositions(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map(nodes.map((n) => [n.id, []]));
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => {
    if (!ids.has(e.source) || !ids.has(e.target)) return;
    degree.set(e.source, degree.get(e.source) + 1);
    degree.set(e.target, degree.get(e.target) + 1);
    if (e.source !== e.target) out.get(e.source).push(e.target);
  });

  // Iterative DFS: post-order gives a topological order of the graph minus back edges
  const state = new Map();
  const order = [];
  const dagEdges = new Map(nodes.map((n) => [n.id, []]));
  nodes.forEach((root) => {
    if (state.has(root.id)) return;
    const stack = [[root.id, 0]];
    state.set(root.id, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [id, i] = frame;
      const targets = out.get(id);
      if (i < targets.length) {
        frame[1] = i + 1;
        const t = targets[i];
        if (!state.has(t)) {
          dagEdges.get(id).push(t);
          state.set(t, 1);
          stack.push([t, 0]);
        } else if (state.get(t) === 2) {
          dagEdges.get(id).push(t); // forward/cross edge; state 1 means a back edge (cycle)
        }
      } else {
        state.set(id, 2);
        order.push(id);
        stack.pop();
      }
    }
  });

  const level = new Map(nodes.map((n) => [n.id, 0]));
  order.reverse().forEach((id) => {
    dagEdges.get(id).forEach((t) => level.set(t, Math.max(level.get(t), level.get(id) + 1)));
  });

  // Connected nodes in columns by level; isolated nodes in a grid below
  const columns = new Map();
  const isolated = [];
  nodes.forEach((n) => {
    if (degree.get(n.id) === 0) {
      isolated.push(n);
      return;
    }
    const l = level.get(n.id);
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l).push(n);
  });

  const positions = new Map();
  let maxColumnHeight = 0;
  columns.forEach((colNodes, l) => {
    colNodes.sort((a, b) => String(a.data.label).localeCompare(String(b.data.label)));
    maxColumnHeight = Math.max(maxColumnHeight, colNodes.length * V_GAP);
    colNodes.forEach((n, i) => positions.set(n.id, { x: l * H_GAP, y: i * V_GAP - (colNodes.length * V_GAP) / 2 }));
  });

  const gridTop = columns.size ? maxColumnHeight / 2 + V_GAP * 1.5 : 0;
  const gridCols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(isolated.length))));
  isolated
    .sort((a, b) => String(a.data.label).localeCompare(String(b.data.label)))
    .forEach((n, i) => positions.set(n.id, { x: (i % gridCols) * H_GAP, y: gridTop + Math.floor(i / gridCols) * V_GAP }));

  return nodes.map((n) => ({ ...n, position: positions.get(n.id) || { x: 0, y: 0 } }));
}

function nodeStyle({ inCycle, failed }) {
  return {
    background: GRAPH_COLORS.node,
    border: `1px solid ${failed ? GRAPH_COLORS.danger : inCycle ? GRAPH_COLORS.warning : GRAPH_COLORS.border}`,
    color: GRAPH_COLORS.text,
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '0.75rem',
    fontFamily: 'var(--cs-font-mono)',
    cursor: 'pointer',
    minWidth: '140px',
    maxWidth: '240px',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    transition: 'opacity 120ms ease',
  };
}

// Set of "source->target" keys for edges that lie on a detected cycle
function cycleEdgeKeys(backendData) {
  const keys = new Set();
  (backendData?.cycles || []).forEach((cycle) => {
    cycle.forEach((id, i) => keys.add(`${id}->${cycle[(i + 1) % cycle.length]}`));
  });
  (backendData?.self_loops || []).forEach((loop) => keys.add(`${loop[0]}->${loop[0]}`));
  return keys;
}

// Convert backend graph_to_json response into React Flow nodes/edges
// idKey selects which backend field to use as the React Flow node id.
// For the file graph: backend node.id = "file_1" but edges reference rel_path (= node.label),
// so we must use 'label' as the id to keep nodes and edges in sync.
function toFlowNodes(backendData, labelKey, idKey = 'id') {
  const cycleNodes = new Set([...(backendData.cycles || []).flat(), ...(backendData.self_loops || []).flat()]);
  const rfNodes = backendData.nodes.map((n) => {
    const id = String(n[idKey]);
    const flags = { inCycle: cycleNodes.has(id), failed: n.parse_status === false };
    return {
      id,
      data: { label: n[labelKey] || n[idKey], ...n, ...flags },
      position: { x: 0, y: 0 }, // set by computeLayeredPositions
      // Left-to-right layout: edges leave on the right and enter on the left
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: nodeStyle(flags),
    };
  });
  return computeLayeredPositions(rfNodes, backendData.edges);
}

function toFlowEdges(backendData) {
  const cycleKeys = cycleEdgeKeys(backendData);
  return backendData.edges.map((e, i) => {
    const inCycle = cycleKeys.has(`${e.source}->${e.target}`);
    const color = inCycle ? GRAPH_COLORS.warning : GRAPH_COLORS.edge;
    return {
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      animated: false,
      data: { inCycle },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: inCycle ? 1.6 : 1.2 },
    };
  });
}

// Compute in/out degree from edges
function computeDegrees(edges) {
  const inDeg = {};
  const outDeg = {};
  edges.forEach((e) => {
    inDeg[e.target] = (inDeg[e.target] || 0) + 1;
    outDeg[e.source] = (outDeg[e.source] || 0) + 1;
  });
  return { inDeg, outDeg };
}

function MetricsPanel({ metrics }) {
  if (!metrics) return null;
  return (
    <div className="stat-strip">
      {[
        ['Nodes', metrics.node_count],
        ['Edges', metrics.edge_count],
        ['Avg in-degree', metrics.avg_in_degree?.toFixed(2) ?? '—'],
        ['Avg out-degree', metrics.avg_out_degree?.toFixed(2) ?? '—'],
      ].map(([label, val]) => (
        <div className="stat" key={label} style={{ padding: '10px 14px' }}>
          <span className="stat-label">{label}</span>
          <span className="stat-value" style={{ fontSize: 'var(--cs-text-lg)' }}>{val}</span>
        </div>
      ))}
      {metrics.top_in_degree?.length > 0 && (
        <div className="stat" style={{ padding: '10px 14px', minWidth: '220px' }}>
          <span className="stat-label">Most depended on</span>
          {metrics.top_in_degree.slice(0, 3).map((item) => (
            <div key={item.id} style={{ fontSize: 'var(--cs-text-xs)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span className="mono truncate" title={item.id}>{item.id.split('::').pop()}</span>
              <span style={{ color: 'var(--cs-accent)', fontWeight: 600 }}>{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeDetails({ node, inDeg, outDeg, graphType, onClose }) {
  if (!node) return null;
  const d = node.data;
  return (
    <div className="panel" style={{
      position: 'absolute',
      right: 12,
      top: 12,
      zIndex: 10,
      width: '300px',
      maxWidth: 'calc(100% - 24px)',
      boxShadow: 'var(--cs-shadow-2)',
    }}>
      <div className="panel-header" style={{ minHeight: '38px' }}>
        <span className="mono truncate" style={{ fontWeight: 600, fontSize: 'var(--cs-text-sm)', color: 'var(--cs-accent)' }} title={d.label}>
          {graphType === 'files' ? d.label : String(d.label)}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close node details" data-tooltip="Close">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="panel-body" style={{ paddingTop: '8px', paddingBottom: '8px' }}>
        {graphType === 'files' ? (
          <>
            <Row label="Language" val={d.language} />
            <Row label="Lines" val={d.line_count} />
            <Row label="Parse" val={d.parse_status ? 'OK' : 'Failed'} tone={d.parse_status ? undefined : 'var(--cs-danger)'} />
          </>
        ) : (
          <>
            <Row label="Type" val={d.type} />
            <Row label="File" val={d.file_path} />
          </>
        )}
        <Row label={graphType === 'files' ? 'Imported by' : 'Called by'} val={inDeg[node.id] ?? 0} />
        <Row label={graphType === 'files' ? 'Imports' : 'Calls'} val={outDeg[node.id] ?? 0} />
        {d.inCycle && <Row label="Cycle" val="Part of a cycle" tone="var(--cs-warning)" />}
      </div>
    </div>
  );
}

function Row({ label, val, tone }) {
  return (
    <div className="kv-row" style={{ padding: '3px 0' }}>
      <span style={{ fontSize: 'var(--cs-text-xs)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 'var(--cs-text-xs)', wordBreak: 'break-all', textAlign: 'right', maxWidth: '180px', color: tone }}>{String(val ?? '—')}</span>
    </div>
  );
}

function CollapsiblePanel({ title, icon, count, tone, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel" style={{ overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="panel-header"
        style={{ width: '100%', background: 'none', border: 'none', borderBottom: open ? '1px solid var(--cs-border)' : 'none', color: 'inherit', textAlign: 'left' }}
      >
        <span className="section-title" style={{ color: tone }}>
          <Icon name={icon} size={13} /> {title} <span className="count">{count}</span>
        </span>
        <Icon name="chevronDown" size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease', color: 'var(--cs-text-subtle)' }} />
      </button>
      {open && <div className="panel-body" style={{ paddingTop: '10px' }}>{children}</div>}
    </section>
  );
}

function UnresolvedPanel({ items, graphType }) {
  if (!items || items.length === 0) return null;
  return (
    <CollapsiblePanel title="Unresolved static references" icon="info" count={items.length}>
      <p className="muted" style={{ fontSize: 'var(--cs-text-xs)', marginBottom: '10px', lineHeight: 1.55 }}>
        Static analysis cannot always resolve built-ins, dynamic method calls, ambiguous names, or external dependencies.
        These references were detected but could not be mapped to an internal symbol.
      </p>
      <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {items.map((item, idx) => (
          <div key={idx} className="mono muted" style={{ fontSize: 'var(--cs-text-xs)' }}>
            {graphType === 'files'
              ? <span>{item.source_file} → {item.module ? `${item.module}.` : ''}{item.imported_name}</span>
              : <span>{item.caller} calls <strong style={{ color: 'var(--cs-text)' }}>{item.callee_raw}</strong> ({item.reason})</span>
            }
          </div>
        ))}
      </div>
    </CollapsiblePanel>
  );
}

function CircularDependenciesPanel({ cycles, selfLoops, graphType, truncated, nodesData }) {
  // Map networkx node ID to human-readable label
  const nodeMap = useMemo(() => {
    const map = {};
    if (nodesData) {
      nodesData.forEach(n => {
        map[n.id] = n.label || n.id;
      });
    }
    return map;
  }, [nodesData]);

  const cycleCount = cycles?.length || 0;
  const selfLoopCount = selfLoops?.length || 0;
  const total = cycleCount + selfLoopCount;

  const getLabel = (id) => nodeMap[id] || id;

  return (
    <CollapsiblePanel
      title={graphType === 'files' ? 'Circular dependencies' : 'Call cycles'}
      icon={total ? 'cycle' : 'checkCircle'}
      count={`${total}${truncated ? '+' : ''}`}
      tone={total ? 'var(--cs-warning)' : undefined}
    >
      {total === 0 ? (
        <div className="status-text success"><Icon name="checkCircle" size={12} /> No circular dependencies detected.</div>
      ) : (
        <>
          {truncated && (
            <div className="muted" style={{ marginBottom: '10px', fontSize: 'var(--cs-text-xs)' }}>
              Cycle detection stopped early due to high graph complexity. Showing partial results.
            </div>
          )}
          <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {selfLoopCount > 0 && (
              <div>
                <div className="section-title" style={{ marginBottom: '4px' }}>
                  {graphType === 'files' ? 'Self-references' : 'Recursions (self-calls)'}
                </div>
                {selfLoops.map((loop, idx) => (
                  <div key={`sl-${idx}`} className="mono" style={{ fontSize: 'var(--cs-text-xs)' }}>
                    {getLabel(loop[0])} → {getLabel(loop[0])}
                  </div>
                ))}
              </div>
            )}

            {cycleCount > 0 && (
              <div>
                <div className="section-title" style={{ marginBottom: '4px' }}>
                  {graphType === 'files' ? 'Circular file dependencies' : 'Call cycles'}
                </div>
                {cycles.map((cycle, idx) => (
                  <div key={`cy-${idx}`} className="mono" style={{ fontSize: 'var(--cs-text-xs)', marginBottom: '2px' }}>
                    {cycle.map(getLabel).join(' → ')} → {getLabel(cycle[0])}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </CollapsiblePanel>
  );
}

function Legend({ graphType }) {
  const item = (color, label, dashed) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ width: '18px', height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      {label}
    </span>
  );
  return (
    <div className="muted" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: 'var(--cs-text-xs)' }}>
      {item(GRAPH_COLORS.edge, graphType === 'files' ? 'imports' : 'calls')}
      {item(GRAPH_COLORS.warning, 'cycle')}
      {graphType === 'files' && item(GRAPH_COLORS.danger, 'failed to parse (border)')}
      <span>Click a node to focus its connections. Drag to pan, scroll to zoom.</span>
    </div>
  );
}

// The main graph canvas sub-component keeps React Flow state internal
function GraphCanvas({ backendData, graphType, labelKey, idKey }) {
  const initialNodes = useMemo(() => backendData ? toFlowNodes(backendData, labelKey, idKey) : [], [backendData, labelKey, idKey]);
  const initialEdges = useMemo(() => backendData ? toFlowEdges(backendData) : [], [backendData]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState(null);

  const { inDeg, outDeg } = useMemo(() => computeDegrees(backendData?.edges || []), [backendData]);

  useEffect(() => {
    if (!backendData) return;
    setSelectedNode(null);
    setNodes(toFlowNodes(backendData, labelKey, idKey));
    setEdges(toFlowEdges(backendData));
  }, [backendData, labelKey, idKey, setNodes, setEdges]);

  const onNodeClick = useCallback((_evt, node) => {
    setSelectedNode(node);
  }, []);

  // Direct neighbours of the selected node stay highlighted; everything else is dimmed
  const neighbours = useMemo(() => {
    if (!selectedNode) return null;
    const set = new Set([selectedNode.id]);
    edges.forEach((e) => {
      if (e.source === selectedNode.id) set.add(e.target);
      if (e.target === selectedNode.id) set.add(e.source);
    });
    return set;
  }, [selectedNode, edges]);

  const styledNodes = useMemo(
    () =>
      nodes.map((n) => {
        if (!neighbours) return n;
        if (n.id === selectedNode.id) {
          return { ...n, style: { ...n.style, background: GRAPH_COLORS.nodeSelected, border: `1px solid ${GRAPH_COLORS.accent}`, boxShadow: '0 0 0 3px rgba(91, 155, 255, 0.18)' } };
        }
        return neighbours.has(n.id) ? n : { ...n, style: { ...n.style, opacity: 0.3 } };
      }),
    [nodes, neighbours, selectedNode]
  );

  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        if (!selectedNode) return e;
        const connected = e.source === selectedNode.id || e.target === selectedNode.id;
        if (!connected) return { ...e, style: { ...e.style, opacity: 0.15 } };
        const color = e.data?.inCycle ? GRAPH_COLORS.warning : GRAPH_COLORS.accent;
        return { ...e, zIndex: 1, style: { ...e.style, stroke: color, strokeWidth: 2 }, markerEnd: { ...e.markerEnd, color } };
      }),
    [edges, selectedNode]
  );

  return (
    // width+height 100% gives React Flow concrete pixel dimensions from the parent.
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {!backendData || backendData.nodes?.length === 0 ? (
        <EmptyState icon="graph" title="This graph is empty">
          {graphType === 'files'
            ? 'No Python files were indexed for this project.'
            : 'No functions or methods were found, so there are no calls to show.'}
        </EmptyState>
      ) : (
        <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedNode(null)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        colorMode="dark"
        style={{ background: GRAPH_COLORS.canvas }}
      >
        <Background color={GRAPH_COLORS.dots} gap={22} size={1.2} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.data?.inCycle ? GRAPH_COLORS.warning : n.data?.failed ? GRAPH_COLORS.danger : '#33405a')}
          nodeStrokeWidth={0}
          maskColor="rgba(7, 9, 12, 0.6)"
        />
      </ReactFlow>
      )}
      {selectedNode && (
        <NodeDetails node={selectedNode} inDeg={inDeg} outDeg={outDeg} graphType={graphType} onClose={() => setSelectedNode(null)} />
      )}
    </div>
  );
}

const GRAPH_TYPES = [
  { id: 'files', label: 'File dependencies', icon: 'files', description: 'Which project files import which. Edges point from the importing file to its dependency.' },
  { id: 'functions', label: 'Function calls', icon: 'function', description: 'Statically resolved calls between project functions and methods.' },
];

export default function DependencyGraphs({ overview }) {
  const [graphType, setGraphType] = useState('files'); // 'files' | 'functions'
  const [fileData, setFileData] = useState(null);
  const [funcData, setFuncData] = useState(null);
  const [fileMetrics, setFileMetrics] = useState(null);
  const [funcMetrics, setFuncMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch stats once for metrics
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/stats`);
        if (!res.ok) return;
        const data = await res.json();
        setFileMetrics(data.file_dependencies);
        setFuncMetrics(data.function_calls);
      } catch (err) {
        console.error("Failed to load graph metrics:", err);
      }
    };
    fetchStats();
  }, [overview.id]);

  // Lazy-fetch each graph when first selected
  useEffect(() => {
    if (graphType === 'files' && !fileData) {
      const fetch_ = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/dependencies/files`);
          if (!res.ok) throw new Error('Failed to fetch file dependency graph');
          setFileData(await res.json());
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      };
      fetch_();
    }
    if (graphType === 'functions' && !funcData) {
      const fetch_ = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/dependencies/functions`);
          if (!res.ok) throw new Error('Failed to fetch function call graph');
          setFuncData(await res.json());
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      };
      fetch_();
    }
  }, [graphType, overview.id]);

  const activeData = graphType === 'files' ? fileData : funcData;
  const activeMetrics = graphType === 'files' ? fileMetrics : funcMetrics;
  const activeLabelKey = 'label'; // both graph types use the 'label' field for display
  // File graph: edges reference rel_path which equals node.label, so idKey='label'.
  // Function graph: edges reference deterministic_id which equals node.id, so idKey='id'.
  const activeIdKey = graphType === 'files' ? 'label' : 'id';
  const activeType = GRAPH_TYPES.find((t) => t.id === graphType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '20px 24px', gap: '14px' }}>
      {/* Header */}
      <div className="page-header" style={{ alignItems: 'center', flexShrink: 0 }}>
        <div>
          <h1 className="page-title">Dependency Graphs</h1>
          <p className="page-description">{activeType.description}</p>
        </div>
        <div className="segmented" role="group" aria-label="Graph type">
          {GRAPH_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={graphType === t.id}
              onClick={() => setGraphType(t.id)}
            >
              <Icon name={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ flexShrink: 0 }}>
        <MetricsPanel metrics={activeMetrics} />
      </div>

      {/* Error */}
      {error && (
        <Banner type="error" boxed title="Could not load the graph.">{error}</Banner>
      )}

      {/* Graph Canvas */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LoadingState>Loading graph...</LoadingState>
        </div>
      ) : activeData ? (
        <>
          <Legend graphType={graphType} />
          {/* minHeight:0 is required on flex children so that the div can shrink
              and React Flow receives a real non-zero pixel height from the parent. */}
          <div style={{ flex: 1, minHeight: '260px', borderRadius: 'var(--cs-radius-lg)', overflow: 'hidden', border: '1px solid var(--cs-border)' }}>
            <GraphCanvas
              key={graphType}
              backendData={activeData}
              graphType={graphType}
              labelKey={activeLabelKey}
              idKey={activeIdKey}
            />
          </div>
          <div className="grid-2" style={{ flexShrink: 0, gap: '12px', alignItems: 'start' }}>
            <CircularDependenciesPanel
              cycles={activeData.cycles}
              selfLoops={activeData.self_loops}
              truncated={activeData.cycles_truncated}
              graphType={graphType}
              nodesData={activeData.nodes}
            />
            <UnresolvedPanel items={activeData.unresolved} graphType={graphType} />
          </div>
        </>
      ) : (
        !error && (
          <EmptyState icon="graph" title="Select a graph">Choose a graph type above to load it.</EmptyState>
        )
      )}
    </div>
  );
}

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../index.css';

// --- Layout: simple grid/row-based deterministic positioning ---
function computeGridPositions(nodes) {
  const COLS = Math.ceil(Math.sqrt(nodes.length)) || 1;
  const H_GAP = 240;
  const V_GAP = 120;
  return nodes.map((n, i) => ({
    ...n,
    position: {
      x: (i % COLS) * H_GAP,
      y: Math.floor(i / COLS) * V_GAP,
    },
  }));
}

// Convert backend graph_to_json response into React Flow nodes/edges
// idKey selects which backend field to use as the React Flow node id.
// For the file graph: backend node.id = "file_1" but edges reference rel_path (= node.label),
// so we must use 'label' as the id to keep nodes and edges in sync.
function toFlowNodes(backendNodes, labelKey, idKey = 'id') {
  const rfNodes = backendNodes.map((n) => ({
    id: String(n[idKey]),
    data: { label: n[labelKey] || n[idKey], ...n },
    position: { x: 0, y: 0 }, // will be set by computeGridPositions
    style: {
      background: '#1e293b',
      border: '1px solid #334155',
      color: '#f8fafc',
      borderRadius: '6px',
      padding: '8px 14px',
      fontSize: '0.82rem',
      fontFamily: 'monospace',
      cursor: 'pointer',
      minWidth: '120px',
      textAlign: 'center',
    },
  }));
  return computeGridPositions(rfNodes);
}

function toFlowEdges(backendEdges) {
  return backendEdges.map((e, i) => ({
    id: `e-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
    style: { stroke: '#3b82f6', strokeWidth: 1.5 },
  }));
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
    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '12px' }}>
      {[
        ['Nodes', metrics.node_count],
        ['Edges', metrics.edge_count],
        ['Avg In-Degree', metrics.avg_in_degree?.toFixed(2) ?? '—'],
        ['Avg Out-Degree', metrics.avg_out_degree?.toFixed(2) ?? '—'],
      ].map(([label, val]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 18px' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
          <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{val}</span>
        </div>
      ))}
      {metrics.top_in_degree?.length > 0 && (
        <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px 16px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Top In-Degree</div>
          {metrics.top_in_degree.slice(0, 3).map((item) => (
            <div key={item.id} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ fontFamily: 'monospace', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px', whiteSpace: 'nowrap' }}>{item.id}</span>
              <span style={{ color: 'var(--primary-color)', fontWeight: 700 }}>{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeDetails({ node, inDeg, outDeg, graphType }) {
  if (!node) return null;
  const d = node.data;
  return (
    <div style={{
      position: 'absolute',
      right: 12,
      bottom: 12,
      zIndex: 10,
      backgroundColor: 'var(--surface-color)',
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      padding: '14px 18px',
      minWidth: '240px',
      maxWidth: '340px',
      fontSize: '0.85rem',
    }}>
      <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '10px', wordBreak: 'break-all', color: 'var(--primary-color)' }}>
        {d.label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--text-muted)' }}>
        {graphType === 'files' ? (
          <>
            <Row label="Language" val={d.language} />
            <Row label="Lines" val={d.line_count} />
            <Row label="Parse" val={d.parse_status ? 'OK' : 'Failed'} />
          </>
        ) : (
          <>
            <Row label="Type" val={d.type} />
            <Row label="File" val={d.file_path} />
          </>
        )}
        <Row label="In-Degree" val={inDeg[node.id] ?? 0} />
        <Row label="Out-Degree" val={outDeg[node.id] ?? 0} />
      </div>
    </div>
  );
}

function Row({ label, val }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
      <span style={{ textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ color: '#f8fafc', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'right', maxWidth: '180px' }}>{String(val ?? '—')}</span>
    </div>
  );
}

function UnresolvedPanel({ items, graphType }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: '12px', backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '10px 14px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}
      >
        <span>Unresolved static references ({items.length})</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-color)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Static analysis cannot always resolve built-ins, dynamic method calls, ambiguous names, or external dependencies.
            These references were detected but could not be mapped to an internal symbol.
          </p>
          <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {items.map((item, idx) => (
              <div key={idx} style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#94a3b8', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {graphType === 'files'
                  ? <span>{item.source_file} → {item.module ? `${item.module}.` : ''}{item.imported_name}</span>
                  : <span>{item.caller} calls <strong style={{ color: '#cbd5e1' }}>{item.callee_raw}</strong> ({item.reason})</span>
                }
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The main graph canvas sub-component keeps React Flow state internal
function GraphCanvas({ backendData, graphType, labelKey, idKey }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  const { inDeg, outDeg } = useMemo(() => computeDegrees(backendData?.edges || []), [backendData]);

  useEffect(() => {
    if (!backendData) return;
    setSelectedNode(null);
    const rfNodes = toFlowNodes(backendData.nodes, labelKey, idKey);
    const rfEdges = toFlowEdges(backendData.edges);
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [backendData, labelKey, idKey]);

  const onNodeClick = useCallback((_evt, node) => {
    setSelectedNode(node);
  }, []);

  const selectedStyle = {
    boxShadow: '0 0 0 2px #3b82f6',
    background: '#1e3a5f',
  };

  const styledNodes = useMemo(
    () =>
      nodes.map((n) =>
        n.id === selectedNode?.id
          ? { ...n, style: { ...n.style, ...selectedStyle } }
          : n
      ),
    [nodes, selectedNode]
  );

  return (
    // width+height 100% gives React Flow concrete pixel dimensions from the parent.
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={styledNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedNode(null)}
        fitView
        colorMode="dark"
        style={{ background: '#0f172a' }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls style={{ background: '#1e293b', border: '1px solid #334155' }} />
        <MiniMap
          style={{ background: '#1e293b' }}
          nodeColor="#3b82f6"
          maskColor="rgba(0,0,0,0.4)"
        />
      </ReactFlow>
      {selectedNode && (
        <NodeDetails node={selectedNode} inDeg={inDeg} outDeg={outDeg} graphType={graphType} />
      )}
    </div>
  );
}

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
      } catch (_) {}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: '24px', gap: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Dependency Graphs</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['files', 'functions'].map((t) => (
            <button
              key={t}
              onClick={() => setGraphType(t)}
              className={graphType === t ? 'btn-primary' : ''}
              style={
                graphType !== t
                  ? { padding: '8px 16px', borderRadius: '6px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' }
                  : { padding: '8px 16px', margin: 0 }
              }
            >
              {t === 'files' ? 'File Dependencies' : 'Function Calls'}
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
        <div className="alert error" style={{ flexShrink: 0 }}>{error}</div>
      )}

      {/* Graph Canvas */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Loading graph...
        </div>
      ) : activeData ? (
        <>
          {/* minHeight:0 is required on flex children so that the div can shrink
              and React Flow receives a real non-zero pixel height from the parent. */}
          <div style={{ flex: 1, minHeight: 0, borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <GraphCanvas
              key={graphType}
              backendData={activeData}
              graphType={graphType}
              labelKey={activeLabelKey}
              idKey={activeIdKey}
            />
          </div>
          <div style={{ flexShrink: 0 }}>
            <UnresolvedPanel items={activeData.unresolved} graphType={graphType} />
          </div>
        </>
      ) : (
        !error && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Select a graph type above to load.
          </div>
        )
      )}
    </div>
  );
}

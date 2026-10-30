import React, { useState, useEffect } from 'react';
import Icon from './ui/Icon';
import { PageHeader, Panel, LoadingState, Banner } from './ui/ui';
import { formatRelativeTime, formatNumber, pluralize } from '../utils/format';
import '../index.css';

const API_BASE = 'http://127.0.0.1:8000';

const QUICK_LINKS = [
  { id: 'search', icon: 'search', title: 'Search', text: 'Weighted search across symbols, files and imports' },
  { id: 'files', icon: 'files', title: 'File Explorer', text: 'Browse, edit, diff and restore source files' },
  { id: 'functions', icon: 'function', title: 'Functions', text: 'References, call hierarchy and impact' },
  { id: 'classes', icon: 'class', title: 'Classes', text: 'Methods, subclasses and references' },
  { id: 'graphs', icon: 'graph', title: 'Dependency Graphs', text: 'File imports and function calls' },
  { id: 'statistics', icon: 'stats', title: 'Statistics', text: 'Size, parsing and graph metrics' },
];

function HealthRow({ status, title, detail, children }) {
  const icon = status === 'ok' ? 'checkCircle' : status === 'warning' ? 'alert' : 'info';
  const color = status === 'ok' ? 'var(--cs-success)' : status === 'warning' ? 'var(--cs-warning)' : 'var(--cs-cyan)';
  return (
    <div className="health-row">
      <span style={{ color, marginTop: '1px' }}><Icon name={icon} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--cs-text-sm)', fontWeight: 500 }}>{title}</div>
        {detail && <div className="muted" style={{ fontSize: 'var(--cs-text-xs)', marginTop: '2px' }}>{detail}</div>}
        {children}
      </div>
    </div>
  );
}

function Dashboard({ overview, onNavigate, onNavigateToFile }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [symbolStats, setSymbolStats] = useState({ functions: 0, methods: 0, classes: 0 });
  const [files, setFiles] = useState([]);
  const [graphStats, setGraphStats] = useState(null);
  const [fileGraph, setFileGraph] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [symRes, filesRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/projects/${overview.id}/symbols`),
          fetch(`${API_BASE}/projects/${overview.id}/files`),
          fetch(`${API_BASE}/projects/${overview.id}/stats`),
        ]);
        if (!symRes.ok) throw new Error("Failed to fetch symbols");
        if (!filesRes.ok) throw new Error("Failed to fetch files");
        if (!statsRes.ok) throw new Error("Failed to fetch stats");

        const symbols = await symRes.json();
        let funcs = 0, methods = 0, classes = 0;
        symbols.forEach(sym => {
          if (sym.symbol_type === 'function' || sym.symbol_type === 'async_function' || sym.symbol_type === 'nested_function') {
            funcs++;
          }
          else if (sym.symbol_type === 'method' || sym.symbol_type === 'async_method') {
            methods++;
          }
          else if (sym.symbol_type === 'class') {
            classes++;
          }
        });
        setSymbolStats({ functions: funcs, methods, classes });
        setFiles(await filesRes.json());
        setGraphStats(await statsRes.json());

        // Cycle and unresolved-import details; the dashboard still works without them
        try {
          const graphRes = await fetch(`${API_BASE}/projects/${overview.id}/dependencies/files`);
          if (graphRes.ok) setFileGraph(await graphRes.json());
        } catch (graphErr) {
          console.error("Failed to load file dependency graph:", graphErr);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (overview?.id) {
      fetchData();
    }
  }, [overview.id]);

  const header = (
    <PageHeader
      title={overview.name}
      description={<>Python project · last indexed {formatRelativeTime(overview.indexed_at)}</>}
      actions={
        <>
          <button type="button" className="btn" onClick={() => onNavigate('search')}>
            <Icon name="search" size={14} /> Search
          </button>
          <button type="button" className="btn-primary" onClick={() => onNavigate('files')}>
            <Icon name="files" size={14} /> Open File Explorer
          </button>
        </>
      }
    />
  );

  if (loading || error) {
    return (
      <div className="page">
        <div className="page-inner page-inner-wide">
          {header}
          {loading ? <LoadingState>Loading project metrics...</LoadingState> : <Banner type="error" boxed title="Could not load the dashboard.">{error}</Banner>}
        </div>
      </div>
    );
  }

  const failedFiles = files.filter(f => !f.parse_status);
  const totalLines = files.reduce((sum, f) => sum + (f.line_count || 0), 0);
  const fileByPath = Object.fromEntries(files.map(f => [f.relative_path, f]));
  const fd = graphStats?.file_dependencies;
  const fc = graphStats?.function_calls;
  const cycles = fileGraph?.cycles || [];
  const selfLoops = fileGraph?.self_loops || [];
  const unresolvedModules = new Set((fileGraph?.unresolved || []).map(u => u.module || u.imported_name));

  const openFile = (path) => {
    const f = fileByPath[path];
    if (f) onNavigateToFile(f.id, null, null, path);
  };

  // Clickable file path (plain text if the path is not an indexed file)
  const fileLink = (path) => (
    fileByPath[path]
      ? <button type="button" className="link-btn mono" style={{ fontSize: 'var(--cs-text-xs)' }} onClick={() => openFile(path)}>{path}</button>
      : <span className="mono" style={{ fontSize: 'var(--cs-text-xs)' }}>{path}</span>
  );

  return (
    <div className="page">
      <div className="page-inner page-inner-wide">
        {header}

        {/* Key metrics */}
        <div className="stat-strip" role="list" aria-label="Project metrics">
          {[
            ['Files', overview.counts.files, 'files'],
            ['Lines of code', totalLines, 'code'],
            ['Classes', symbolStats.classes, 'class'],
            ['Functions', symbolStats.functions, 'function'],
            ['Methods', symbolStats.methods, 'method'],
            ['Imports', overview.counts.imports, 'package'],
            ['Calls', overview.counts.calls, 'callHierarchy'],
          ].map(([label, value, icon]) => (
            <div className="stat" role="listitem" key={label}>
              <span className="stat-label"><Icon name={icon} size={12} /> {label}</span>
              <span className="stat-value">{formatNumber(value)}</span>
            </div>
          ))}
        </div>

        <div className="dashboard-grid">
          {/* Health */}
          <Panel title="Project health" icon="checkCircle" bodyStyle={{ paddingTop: 0, paddingBottom: '4px' }}>
            <HealthRow
              status={failedFiles.length ? 'warning' : 'ok'}
              title={failedFiles.length ? `${failedFiles.length} of ${pluralize(files.length, 'file')} failed to parse` : `All ${pluralize(files.length, 'file')} parsed successfully`}
              detail={failedFiles.length ? 'Symbols, calls and imports are missing for these files until their syntax errors are fixed.' : 'Every file was indexed with full symbol information.'}
            >
              {failedFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' }}>
                  {failedFiles.slice(0, 5).map(f => <React.Fragment key={f.id}>{fileLink(f.relative_path)}</React.Fragment>)}
                  {failedFiles.length > 5 && <span className="subtle" style={{ fontSize: 'var(--cs-text-xs)' }}>and {failedFiles.length - 5} more</span>}
                </div>
              )}
            </HealthRow>

            {fileGraph ? (
              <HealthRow
                status={cycles.length || selfLoops.length ? 'warning' : 'ok'}
                title={
                  cycles.length || selfLoops.length
                    ? `${pluralize(cycles.length, 'circular file dependency', 'circular file dependencies')}${fileGraph.cycles_truncated ? '+' : ''}${selfLoops.length ? `, ${pluralize(selfLoops.length, 'self-import')}` : ''}`
                    : 'No circular file dependencies'
                }
                detail={cycles.length || selfLoops.length ? 'Import cycles make modules harder to change and test in isolation.' : 'The import graph between project files is acyclic.'}
              >
                {(cycles.length > 0 || selfLoops.length > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                    {[...selfLoops.map(l => [l[0]]), ...cycles].slice(0, 4).map((cycle, i) => (
                      <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                        {[...cycle, cycle[0]].map((path, j) => (
                          <React.Fragment key={j}>
                            {j > 0 && <Icon name="arrowRight" size={11} className="subtle" />}
                            {fileLink(path)}
                          </React.Fragment>
                        ))}
                      </div>
                    ))}
                    <button type="button" className="link-btn" style={{ fontSize: 'var(--cs-text-xs)', marginTop: '2px' }} onClick={() => onNavigate('graphs')}>
                      View in dependency graph →
                    </button>
                  </div>
                )}
              </HealthRow>
            ) : (
              <HealthRow status="info" title="Dependency cycle check unavailable" detail="The file dependency graph could not be loaded." />
            )}

            {fileGraph && (
              <HealthRow
                status="info"
                title={unresolvedModules.size ? `${pluralize(unresolvedModules.size, 'external or unresolved module')}` : 'All imports resolve to project files'}
                detail={unresolvedModules.size ? 'Standard library, third-party, or relative imports that static analysis could not map to a project file.' : undefined}
              >
                {unresolvedModules.size > 0 && (
                  <div className="mono subtle" style={{ fontSize: 'var(--cs-text-xs)', marginTop: '4px', wordBreak: 'break-word' }}>
                    {[...unresolvedModules].slice(0, 8).join(', ')}{unresolvedModules.size > 8 ? ', …' : ''}
                  </div>
                )}
              </HealthRow>
            )}
          </Panel>

          {/* Import structure */}
          <Panel title="Imports" icon="package" bodyStyle={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="dashboard-metric-pair">
              <div><span className="stat-label">Files in graph</span><span className="stat-value">{fd?.node_count ?? 0}</span></div>
              <div><span className="stat-label">Import edges</span><span className="stat-value">{fd?.edge_count ?? 0}</span></div>
            </div>
            <div>
              <div className="section-title" style={{ marginBottom: '4px' }}>Most imported files</div>
              {fd?.top_in_degree?.length ? fd.top_in_degree.slice(0, 5).map(t => (
                <div className="kv-row" key={t.id}>{fileLink(t.id)}<span className="muted">{pluralize(t.count, 'importer')}</span></div>
              )) : <div className="empty-inline">No project file is imported by another.</div>}
            </div>
          </Panel>

          {/* Call structure */}
          <Panel title="Calls" icon="callHierarchy" bodyStyle={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="dashboard-metric-pair">
              <div><span className="stat-label">Functions in graph</span><span className="stat-value">{fc?.node_count ?? 0}</span></div>
              <div><span className="stat-label">Resolved calls</span><span className="stat-value">{fc?.edge_count ?? 0}</span></div>
            </div>
            <div>
              <div className="section-title" style={{ marginBottom: '4px' }}>Most called functions</div>
              {fc?.top_in_degree?.length ? fc.top_in_degree.slice(0, 5).map(t => (
                <div className="kv-row" key={t.id}>
                  <span className="mono truncate" style={{ color: 'var(--cs-text)', fontSize: 'var(--cs-text-xs)' }} title={t.id}>{t.id.split('::').pop()}</span>
                  <span className="muted">{pluralize(t.count, 'caller')}</span>
                </div>
              )) : <div className="empty-inline">No resolved function calls.</div>}
            </div>
          </Panel>
        </div>

        {/* Quick navigation */}
        <section>
          <h2 className="section-title" style={{ marginBottom: '10px' }}>Jump to</h2>
          <div className="quick-links">
            {QUICK_LINKS.map(link => (
              <button key={link.id} type="button" className="result-row" style={{ flexDirection: 'row', alignItems: 'center', gap: '12px', padding: '12px 14px' }} onClick={() => onNavigate(link.id)}>
                <span className="dropzone-icon" style={{ width: '30px', height: '30px' }}><Icon name={link.icon} size={15} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 'var(--cs-text-sm)', fontWeight: 500 }}>{link.title}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 'var(--cs-text-xs)', lineHeight: 1.45 }}>{link.text}</span>
                </span>
                <Icon name="chevronRight" size={14} className="subtle" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;

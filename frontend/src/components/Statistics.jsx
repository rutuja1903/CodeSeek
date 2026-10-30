import React, { useState, useEffect, useMemo } from 'react';
import { Panel, PageHeader, LoadingState, Banner } from './ui/ui';
import '../index.css';

// Reusable panel for a group of statistics
function StatCard({ title, icon, children }) {
  return (
    <Panel title={title} icon={icon} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {children}
    </Panel>
  );
}

// A single key-value row
function StatRow({ label, value, valueStyle }) {
  return (
    <div className="kv-row">
      <span style={{ textTransform: 'capitalize' }}>{label}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
}

// A thin horizontal meter for visual proportion
function ProgressBar({ value, total, color }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', margin: '2px 0 6px' }}>
      <div className="meter" style={{ flex: 1 }} role="presentation">
        <div style={{ width: `${percentage}%`, background: color || 'var(--cs-accent)' }} />
      </div>
      <span className="mono subtle" style={{ fontSize: 'var(--cs-text-2xs)', minWidth: '34px', textAlign: 'right' }}>{percentage}%</span>
    </div>
  );
}

function SubHeading({ children, tone }) {
  return <div className="section-title" style={{ marginTop: '12px', marginBottom: '6px', color: tone }}>{children}</div>;
}

function RankedRow({ rank, name, value, title }) {
  return (
    <div className="kv-row" style={{ padding: '3px 0' }}>
      <span className="mono truncate" style={{ color: 'var(--cs-text)', fontSize: 'var(--cs-text-xs)' }} title={title || name}>
        <span className="subtle" style={{ marginRight: '6px' }}>{rank}</span>{name}
      </span>
      <span className="muted" style={{ fontSize: 'var(--cs-text-xs)', flexShrink: 0 }}>{value}</span>
    </div>
  );
}

export default function Statistics({ overview }) {
  const [statsData, setStatsData] = useState(null);
  const [filesData, setFilesData] = useState([]);
  const [symbolsData, setSymbolsData] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const [statsRes, filesRes, symbolsRes] = await Promise.all([
          fetch(`http://127.0.0.1:8000/projects/${overview.id}/stats`),
          fetch(`http://127.0.0.1:8000/projects/${overview.id}/files`),
          fetch(`http://127.0.0.1:8000/projects/${overview.id}/symbols`)
        ]);

        if (!statsRes.ok) throw new Error("Failed to fetch stats");
        if (!filesRes.ok) throw new Error("Failed to fetch files");
        if (!symbolsRes.ok) throw new Error("Failed to fetch symbols");

        setStatsData(await statsRes.json());
        setFilesData(await filesRes.json());
        setSymbolsData(await symbolsRes.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [overview.id]);

  // --- Derived Metrics ---
  const derived = useMemo(() => {
    if (!filesData.length || !symbolsData.length) return {};

    // 1. Files / Repo Size
    const totalFiles = filesData.length;
    let totalLines = 0;
    let parsedSuccessfully = 0;
    const failedFiles = [];
    
    filesData.forEach(f => {
      totalLines += (f.line_count || 0);
      if (f.parse_status) {
        parsedSuccessfully++;
      } else {
        failedFiles.push(f.relative_path);
      }
    });

    const avgLinesPerFile = totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0;
    const largestFiles = [...filesData].sort((a, b) => (b.line_count || 0) - (a.line_count || 0)).slice(0, 5);

    // 2. Symbols
    const symbolCounts = {};
    let totalSymbols = 0;
    symbolsData.forEach(s => {
      totalSymbols++;
      const type = s.symbol_type;
      symbolCounts[type] = (symbolCounts[type] || 0) + 1;
    });

    return {
      totalLines,
      avgLinesPerFile,
      largestFiles,
      parsedSuccessfully,
      failedFiles,
      symbolCounts,
      totalSymbols
    };
  }, [filesData, symbolsData]);

  const header = (
    <PageHeader
      title="Statistics"
      description="Repository size, parsing health, symbol composition and graph metrics for this project."
    />
  );

  if (loading) {
    return (
      <div className="page"><div className="page-inner page-inner-wide">{header}<LoadingState>Loading statistics...</LoadingState></div></div>
    );
  }

  if (error) {
    return (
      <div className="page"><div className="page-inner page-inner-wide">{header}<Banner type="error" boxed title="Could not load statistics.">{error}</Banner></div></div>
    );
  }

  const { file_dependencies: fd, function_calls: fc } = statsData || {};
  const parseOk = !derived.failedFiles?.length;

  return (
    <div className="page">
      <div className="page-inner page-inner-wide">
        {header}

        {/* Headline numbers */}
        <div className="stat-strip">
          {[
            ['Files', overview.counts?.files],
            ['Lines of code', derived.totalLines],
            ['Symbols', derived.totalSymbols],
            ['Imports', overview.counts?.imports],
            ['Calls', overview.counts?.calls],
          ].map(([label, value]) => (
            <div className="stat" key={label}>
              <span className="stat-label">{label}</span>
              <span className="stat-value">{typeof value === 'number' ? value.toLocaleString() : (value ?? '—')}</span>
            </div>
          ))}
        </div>

        <div className="grid-3">
          {/* Parsing Health */}
          <StatCard title="Parsing health" icon={parseOk ? 'checkCircle' : 'alert'}>
            <StatRow label="Successfully parsed" value={`${derived.parsedSuccessfully ?? 0} / ${filesData.length}`} valueStyle={{ color: parseOk ? 'var(--cs-success)' : 'var(--cs-warning)' }} />
            <ProgressBar value={derived.parsedSuccessfully} total={filesData.length} color={parseOk ? 'var(--cs-success)' : 'var(--cs-warning)'} />

            {derived.failedFiles?.length > 0 ? (
              <>
                <SubHeading tone="var(--cs-danger)">Failed files ({derived.failedFiles.length})</SubHeading>
                <div className="mono" style={{
                  maxHeight: '110px',
                  overflowY: 'auto',
                  background: 'var(--cs-danger-soft)',
                  border: '1px solid var(--cs-danger-border)',
                  padding: '6px 8px',
                  borderRadius: 'var(--cs-radius-sm)',
                  fontSize: 'var(--cs-text-xs)',
                  color: 'var(--cs-danger)'
                }}>
                  {derived.failedFiles.map(fp => <div key={fp}>{fp}</div>)}
                </div>
              </>
            ) : (
              <div className="status-text success" style={{ marginTop: '4px' }}>Every file was parsed without syntax errors.</div>
            )}
          </StatCard>

          {/* Repository Size */}
          <StatCard title="Repository size" icon="files">
            <StatRow label="Total lines" value={derived.totalLines?.toLocaleString()} />
            <StatRow label="Average lines / file" value={derived.avgLinesPerFile?.toLocaleString()} />

            <SubHeading>Largest files</SubHeading>
            {derived.largestFiles?.map((f, i) => (
              <RankedRow key={f.id} rank={i + 1} name={f.relative_path} value={`${f.line_count} lines`} />
            ))}
          </StatCard>

          {/* Symbol Breakdown */}
          <StatCard title="Symbol breakdown" icon="layers">
            {Object.entries(derived.symbolCounts || {})
              .sort(([, aCount], [, bCount]) => bCount - aCount)
              .map(([type, count]) => (
                <div key={type}>
                  <StatRow label={type.replace('_', ' ')} value={count} />
                  <ProgressBar value={count} total={derived.totalSymbols} />
                </div>
              ))
            }
            {!derived.totalSymbols && <div className="empty-inline">No symbols were found.</div>}
          </StatCard>

          {/* File Dependency Metrics */}
          <StatCard title="File dependencies" icon="graph">
            {fd ? (
              <>
                <StatRow label="Nodes (files)" value={fd.node_count} />
                <StatRow label="Edges (imports)" value={fd.edge_count} />
                <StatRow label="Avg in-degree" value={fd.avg_in_degree?.toFixed(2) ?? '—'} />
                <StatRow label="Avg out-degree" value={fd.avg_out_degree?.toFixed(2) ?? '—'} />

                {fd.top_in_degree?.length > 0 && (
                  <>
                    <SubHeading>Most imported files</SubHeading>
                    {fd.top_in_degree.slice(0, 5).map((t, i) => (
                      <RankedRow key={t.id} rank={i + 1} name={t.id} value={`${t.count} importer${t.count === 1 ? '' : 's'}`} />
                    ))}
                  </>
                )}
              </>
            ) : (
              <div className="empty-inline">No dependency data available.</div>
            )}
          </StatCard>

          {/* Function Call Metrics */}
          <StatCard title="Function calls" icon="callHierarchy">
            {fc ? (
              <>
                <StatRow label="Nodes (functions)" value={fc.node_count} />
                <StatRow label="Edges (calls)" value={fc.edge_count} />
                <StatRow label="Avg in-degree" value={fc.avg_in_degree?.toFixed(2) ?? '—'} />
                <StatRow label="Avg out-degree" value={fc.avg_out_degree?.toFixed(2) ?? '—'} />

                {fc.top_in_degree?.length > 0 && (
                  <>
                    <SubHeading>Most called functions</SubHeading>
                    {fc.top_in_degree.slice(0, 5).map((t, i) => (
                      <RankedRow key={t.id} rank={i + 1} name={t.id.split('::').pop()} title={t.id} value={`${t.count} caller${t.count === 1 ? '' : 's'}`} />
                    ))}
                  </>
                )}
              </>
            ) : (
              <div className="empty-inline">No call data available.</div>
            )}
          </StatCard>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import '../index.css';

// Reusable card for a group of statistics
function StatCard({ title, children, style }) {
  return (
    <div style={{
      backgroundColor: 'var(--surface-color)',
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      ...style
    }}>
      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--primary-color)' }}>{title}</h3>
      {children}
    </div>
  );
}

// A single key-value row
function StatRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-main)', ...valueStyle }}>{value}</span>
    </div>
  );
}

// A simple horizontal bar for visual proportion
function ProgressBar({ value, total, color }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
      <div style={{ flex: 1, backgroundColor: 'var(--bg-color)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${percentage}%`, backgroundColor: color || 'var(--primary-color)', height: '100%' }} />
      </div>
      <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', minWidth: '40px', textAlign: 'right' }}>{percentage}%</span>
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        Loading statistics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <p className="alert error">{error}</p>
      </div>
    );
  }

  const { file_dependencies: fd, function_calls: fc } = statsData || {};

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px', backgroundColor: 'var(--bg-color)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
          <div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '1.6rem', fontWeight: 700 }}>Repository Statistics</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Project: {overview.name}</div>
          </div>
        </div>

        {/* Dashboard-style Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          
          {/* 1. Project Overview */}
          <StatCard title="Project Overview">
            <StatRow label="Total Files" value={overview.counts?.files} />
            <StatRow label="Total Symbols" value={derived.totalSymbols} />
            <StatRow label="Imports" value={overview.counts?.imports} />
            <StatRow label="Function Calls" value={overview.counts?.calls} />
            <StatRow label="Total Lines of Code" value={derived.totalLines?.toLocaleString()} valueStyle={{ color: 'var(--primary-color)' }} />
          </StatCard>

          {/* 3. Parsing Health */}
          <StatCard title="Parsing Health">
            <StatRow label="Successfully Parsed" value={`${derived.parsedSuccessfully} / ${filesData.length}`} />
            <ProgressBar value={derived.parsedSuccessfully} total={filesData.length} color={derived.failedFiles?.length > 0 ? '#eab308' : '#22c55e'} />
            
            {derived.failedFiles?.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '0.75rem', color: '#ef4444', textTransform: 'uppercase' }}>Failed Files ({derived.failedFiles.length})</span>
                <div style={{ 
                  maxHeight: '100px', 
                  overflowY: 'auto', 
                  backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                  padding: '8px', 
                  borderRadius: '4px',
                  marginTop: '4px',
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                  color: '#fca5a5'
                }}>
                  {derived.failedFiles.map(fp => <div key={fp}>{fp}</div>)}
                </div>
              </div>
            )}
          </StatCard>

          {/* 4. Repository Size */}
          <StatCard title="Repository Size">
            <StatRow label="Total Lines" value={derived.totalLines?.toLocaleString()} />
            <StatRow label="Average Lines / File" value={derived.avgLinesPerFile?.toLocaleString()} />
            
            <div style={{ marginTop: '12px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Largest Files</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                {derived.largestFiles?.map((f, i) => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-main)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                      {i + 1}. {f.relative_path}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{f.line_count} lines</span>
                  </div>
                ))}
              </div>
            </div>
          </StatCard>

          {/* 2. Symbol Breakdown */}
          <StatCard title="Symbol Breakdown">
            {Object.entries(derived.symbolCounts || {})
              .sort(([, aCount], [, bCount]) => bCount - aCount)
              .map(([type, count]) => (
                <div key={type} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <StatRow label={type.replace('_', ' ')} value={count} />
                  <ProgressBar value={count} total={derived.totalSymbols} />
                </div>
              ))
            }
          </StatCard>

          {/* 5 & 6. File Dependency Metrics */}
          <StatCard title="File Dependencies">
            {fd ? (
              <>
                <StatRow label="Nodes (Files)" value={fd.node_count} />
                <StatRow label="Edges (Imports)" value={fd.edge_count} />
                <StatRow label="Avg In-Degree" value={fd.avg_in_degree?.toFixed(2)} />
                <StatRow label="Avg Out-Degree" value={fd.avg_out_degree?.toFixed(2)} />
                
                {fd.top_in_degree?.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Most Imported Files</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      {fd.top_in_degree.slice(0, 5).map((t, i) => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span style={{ color: 'var(--text-main)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                            {i + 1}. {t.id}
                          </span>
                          <span style={{ color: 'var(--primary-color)' }}>{t.count} times</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No dependency data available.</p>
            )}
          </StatCard>

          {/* 5 & 6. Function Call Metrics */}
          <StatCard title="Function Calls">
            {fc ? (
              <>
                <StatRow label="Nodes (Functions)" value={fc.node_count} />
                <StatRow label="Edges (Calls)" value={fc.edge_count} />
                <StatRow label="Avg In-Degree" value={fc.avg_in_degree?.toFixed(2)} />
                <StatRow label="Avg Out-Degree" value={fc.avg_out_degree?.toFixed(2)} />
                
                {fc.top_in_degree?.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Most Called Functions</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      {fc.top_in_degree.slice(0, 5).map((t, i) => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', gap: '12px' }}>
                          <span style={{ color: 'var(--text-main)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                            {i + 1}. {t.id.split('::').pop()}
                          </span>
                          <span style={{ color: 'var(--primary-color)' }}>{t.count} calls</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No call data available.</p>
            )}
          </StatCard>

        </div>
      </div>
    </div>
  );
}

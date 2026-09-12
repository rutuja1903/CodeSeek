import React, { useState, useEffect } from 'react';
import '../index.css';

function Dashboard({ overview }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [symbolStats, setSymbolStats] = useState({ functions: 0, methods: 0, classes: 0 });
  const [fileStats, setFileStats] = useState({ success: 0, failed: 0 });
  const [graphStats, setGraphStats] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // 1. Fetch symbols
        const symRes = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/symbols`);
        if (!symRes.ok) throw new Error("Failed to fetch symbols");
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

        // 2. Fetch files for parse stats
        const filesRes = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files`);
        if (!filesRes.ok) throw new Error("Failed to fetch files");
        const files = await filesRes.json();
        
        let success = 0, failed = 0;
        files.forEach(f => {
          if (f.parse_status) success++;
          else failed++;
        });
        setFileStats({ success, failed });

        // 3. Fetch stats for graph metrics
        const statsRes = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/stats`);
        if (!statsRes.ok) throw new Error("Failed to fetch stats");
        const stats = await statsRes.json();
        setGraphStats(stats);
        
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

  if (loading) {
    return (
      <div className="workspace-view">
        <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '16px' }}>Dashboard</h2>
        <p style={{ color: 'var(--text-muted)' }}>Loading project metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workspace-view">
        <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '16px' }}>Dashboard</h2>
        <div className="alert error">
          <p><strong>Error:</strong> {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-view">
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '4px' }}>Dashboard</h2>
        <p className="subtitle">Overview for {overview.name} (ID: {overview.id})</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div className="stat-box">
          <span className="stat-label">Total Files</span>
          <span className="stat-value">{overview.counts.files}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Total Symbols</span>
          <span className="stat-value">{overview.counts.symbols}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Imports</span>
          <span className="stat-value">{overview.counts.imports}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Calls</span>
          <span className="stat-value">{overview.counts.calls}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.1rem', fontWeight: 600 }}>Code Breakdown</h3>
          <div className="stats-grid">
            <div className="stat-box">
              <span className="stat-label">Classes</span>
              <span className="stat-value">{symbolStats.classes}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Functions</span>
              <span className="stat-value">{symbolStats.functions}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Methods</span>
              <span className="stat-value">{symbolStats.methods}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.1rem', fontWeight: 600 }}>Parsing Status</h3>
          <div className="stats-grid">
            <div className="stat-box">
              <span className="stat-label">Successfully Parsed</span>
              <span className="stat-value" style={{ color: 'var(--success-text)' }}>{fileStats.success}</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">Failed to Parse</span>
              <span className="stat-value" style={{ color: fileStats.failed > 0 ? 'var(--error-text)' : 'inherit' }}>{fileStats.failed}</span>
            </div>
          </div>
        </div>

        {graphStats && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.1rem', fontWeight: 600 }}>Graph Metrics</h3>
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">File Dependencies (Nodes)</span>
                <span className="stat-value">{graphStats.file_dependencies?.node_count || 0}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">File Dependencies (Edges)</span>
                <span className="stat-value">{graphStats.file_dependencies?.edge_count || 0}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Function Calls (Nodes)</span>
                <span className="stat-value">{graphStats.function_calls?.node_count || 0}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Function Calls (Edges)</span>
                <span className="stat-value">{graphStats.function_calls?.edge_count || 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;

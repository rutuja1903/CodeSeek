import React, { useState, useEffect } from 'react';
import '../index.css';

function Dashboard({ overview, onSearchClick, onBack }) {
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
      <div className="card">
        <h2>Dashboard: {overview.name}</h2>
        <p>Loading project metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2>Dashboard: {overview.name}</h2>
        <div className="alert error">
          <p><strong>Error:</strong> {error}</p>
        </div>
        <button className="btn-primary" onClick={onBack}>Back to Home</button>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ marginTop: 0 }}>Dashboard: {overview.name}</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>Project ID: {overview.id}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-primary" onClick={onSearchClick}>Search</button>
            <button className="btn-primary" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginTop: '1.5rem' }}>
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

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Code Breakdown</h3>
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

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Parsing Status</h3>
        <div className="stats-grid">
          <div className="stat-box">
            <span className="stat-label">Successfully Parsed</span>
            <span className="stat-value" style={{ color: 'var(--success-color, #10b981)' }}>{fileStats.success}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Failed to Parse</span>
            <span className="stat-value" style={{ color: fileStats.failed > 0 ? 'var(--error-color, #ef4444)' : 'inherit' }}>{fileStats.failed}</span>
          </div>
        </div>
      </div>

      {graphStats && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Graph Metrics</h3>
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
  );
}

export default Dashboard;

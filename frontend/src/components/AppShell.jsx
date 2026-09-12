import React, { useState, useRef } from 'react';
import '../index.css';

function AppShell({ overview, activeTab, onNavigate, onUpdateOverview, children }) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleUpdate = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError("Please select a .zip file.");
      e.target.value = '';
      return;
    }

    setUpdating(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/update-upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Update failed");
      }
      
      const data = await response.json();
      const overviewRes = await fetch(`http://127.0.0.1:8000/projects/${data.project_id}`);
      if (!overviewRes.ok) throw new Error("Could not fetch updated project overview");
      
      const updatedOverview = await overviewRes.json();
      onUpdateOverview(updatedOverview);
      
      // Clear file input
      e.target.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };
  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h2 style={{ margin: 0 }}>CodeSeek</h2>
          <div className="sidebar-project" title={overview.name}>{overview.name}</div>
        </div>
        
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onNavigate('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => onNavigate('search')}
          >
            Search
          </button>
          <button 
            className={`nav-item ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => onNavigate('files')}
          >
            File Explorer
          </button>
          <button 
            className={`nav-item ${activeTab === 'functions' ? 'active' : ''}`}
            onClick={() => onNavigate('functions')}
          >
            Functions
          </button>
          <button 
            className={`nav-item ${activeTab === 'classes' ? 'active' : ''}`}
            onClick={() => onNavigate('classes')}
          >
            Classes
          </button>
          <button 
            className={`nav-item ${activeTab === 'graphs' ? 'active' : ''}`}
            onClick={() => onNavigate('graphs')}
          >
            Graphs
          </button>
          <button 
            className={`nav-item ${activeTab === 'statistics' ? 'active' : ''}`}
            onClick={() => onNavigate('statistics')}
          >
            Statistics
          </button>
        </nav>

        {/* Update Project Action */}
        <div style={{ marginTop: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)' }}>
          {error && <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</div>}
          <input 
            type="file" 
            ref={fileInputRef} 
            accept=".zip" 
            style={{ display: 'none' }} 
            onChange={handleUpdate} 
            disabled={updating}
          />
          <button 
            className="btn-primary" 
            style={{ width: '100%', fontSize: '0.85rem' }}
            disabled={updating}
            onClick={() => fileInputRef.current?.click()}
          >
            {updating ? "Updating..." : "Update Project (ZIP)"}
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}

export default AppShell;

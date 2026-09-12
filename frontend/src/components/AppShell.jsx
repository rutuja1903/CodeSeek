import React from 'react';
import '../index.css';

function AppShell({ overview, activeTab, onNavigate, children }) {
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
        </nav>
      </aside>

      {/* Main Workspace */}
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}

export default AppShell;

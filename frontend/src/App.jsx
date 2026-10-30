import { useState, useRef } from 'react';
import Dashboard from './components/Dashboard';
import Search from './components/Search';
import FileExplorer from './components/FileExplorer';
import FunctionExplorer from './components/FunctionExplorer';
import ClassExplorer from './components/ClassExplorer';
import DependencyGraphs from './components/DependencyGraphs';
import Statistics from './components/Statistics';
import AppShell from './components/AppShell';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState(null); // null means home
  const [fileNavTarget, setFileNavTarget] = useState(null);
  const [symbolNavTarget, setSymbolNavTarget] = useState(null);
  const [isEditorDirty, setIsEditorDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState(null);
  const [showTabDiscardModal, setShowTabDiscardModal] = useState(false);
  const [name, setName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null); // File object from <input type="file">
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overview, setOverview] = useState(null);
  const fileInputRef = useRef(null);

  const handleTabNavigate = (targetTab) => {
    if (activeTab === 'files' && isEditorDirty && targetTab !== 'files') {
      setPendingTab(targetTab);
      setShowTabDiscardModal(true);
      return;
    }
    setActiveTab(targetTab);
  };

  const handleConfirmTabDiscard = () => {
    setIsEditorDirty(false);
    setShowTabDiscardModal(false);
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  };

  const handleCancelTabDiscard = () => {
    setShowTabDiscardModal(false);
    setPendingTab(null);
  };

  const handleNavigateToFile = (fileId, startLine, endLine) => {
    setFileNavTarget({ fileId, startLine, endLine });
    setActiveTab('files');
  };

  const handleNavigateToSymbol = (symbolId, symbolType) => {
    setSymbolNavTarget(symbolId);
    if (symbolType === 'class') {
      handleTabNavigate('classes');
    } else {
      handleTabNavigate('functions');
    }
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && !f.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a .zip file.');
      setSelectedFile(null);
      e.target.value = '';
      return;
    }
    setError(null);
    setSelectedFile(f);
  };

  const handleAnalyze = async (e) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter a project name.');
      return;
    }
    if (!selectedFile) {
      setError('Please choose a .zip file to upload.');
      return;
    }

    setLoading(true);
    setError(null);
    setOverview(null);
    setActiveTab(null);

    try {
      // Build multipart/form-data — do NOT set Content-Type header manually;
      // the browser sets it automatically with the correct boundary.
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('file', selectedFile, selectedFile.name);

      const response = await fetch('http://127.0.0.1:8000/projects/analyze-upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Upload failed (HTTP ${response.status})`);
      }

      const data = await response.json();

      // Fetch project overview
      const overviewRes = await fetch(`http://127.0.0.1:8000/projects/${data.project_id}`);
      if (!overviewRes.ok) throw new Error('Indexing succeeded but could not fetch project overview.');
      const overviewData = await overviewRes.json();
      setOverview(overviewData);
      setActiveTab('dashboard');

    } catch (err) {
      setError(err.message || 'Could not connect to the backend.');
    } finally {
      setLoading(false);
    }
  };

  // If we have a project loaded and an active tab, render the AppShell
  if (activeTab && overview) {
    return (
      <>
        <AppShell 
          overview={overview} 
          activeTab={activeTab} 
          onNavigate={handleTabNavigate} 
          onUpdateOverview={setOverview}
          isEditorDirty={isEditorDirty}
        >
          {activeTab === 'dashboard' && <Dashboard overview={overview} />}
          {activeTab === 'search' && <Search overview={overview} onNavigateToSymbol={handleNavigateToSymbol} onNavigateToFile={handleNavigateToFile} />}
          {activeTab === 'files' && (
            <FileExplorer 
              overview={overview} 
              fileNavTarget={fileNavTarget} 
              clearNavTarget={() => setFileNavTarget(null)}
              onDirtyChange={setIsEditorDirty}
              onUpdateOverview={setOverview}
            />
          )}
          {activeTab === 'functions' && <FunctionExplorer overview={overview} onNavigateToFile={handleNavigateToFile} symbolNavTarget={symbolNavTarget} clearSymbolNavTarget={() => setSymbolNavTarget(null)} />}
          {activeTab === 'classes' && <ClassExplorer overview={overview} onNavigateToFile={handleNavigateToFile} symbolNavTarget={symbolNavTarget} clearSymbolNavTarget={() => setSymbolNavTarget(null)} />}
          {activeTab === 'graphs' && <DependencyGraphs overview={overview} />}
          {activeTab === 'statistics' && <Statistics overview={overview} />}
        </AppShell>

        {/* Tab Switch Discard Confirmation Modal */}
        {showTabDiscardModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              backgroundColor: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '460px',
              width: '90%',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: 'var(--text-main)' }}>
                Unsaved Changes
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
                You have unsaved changes in the editor. Navigating to the <strong style={{ color: 'var(--text-main)' }}>{pendingTab}</strong> tab will discard your changes. Do you want to continue?
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={handleCancelTabDiscard}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'transparent',
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Keep Editing
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTabDiscard}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.85rem',
                  }}
                >
                  Discard &amp; Switch
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Home / upload screen
  return (
    <div className="home-container">
      <header className="header">
        <h1>CodeSeek</h1>
        <p className="subtitle">Explore and understand Python codebases</p>
      </header>

      <main className="main-content">
        <div className="card form-card">
          <h2>Analyze Project</h2>
          <form onSubmit={handleAnalyze}>
            {/* Project name */}
            <div className="form-group">
              <label htmlFor="name">Project Name</label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., sample_shop"
                disabled={loading}
              />
            </div>

            {/* ZIP file chooser */}
            <div className="form-group">
              <label htmlFor="zipFile">Repository ZIP</label>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  id="zipFile"
                  accept=".zip"
                  onChange={handleFileChange}
                  disabled={loading}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '6px',
                    border: '1px dashed var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-muted)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '0.9rem',
                    textAlign: 'left',
                  }}
                >
                  {selectedFile
                    ? `\u2713 ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
                    : 'Choose .zip file\u2026'}
                </button>
                {selectedFile && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Selected: {selectedFile.name}
                  </span>
                )}
              </div>
            </div>

            <button type="submit" disabled={loading || !selectedFile} className="btn-primary">
              {loading ? 'Uploading & Analyzing\u2026' : 'Analyze Project'}
            </button>
          </form>
        </div>

        {error && (
          <div className="alert error">
            <p><strong>Error:</strong> {error}</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

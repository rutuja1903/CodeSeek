import { useState, useRef } from 'react';
import Dashboard from './components/Dashboard';
import Search from './components/Search';
import FileExplorer from './components/FileExplorer';
import FunctionExplorer from './components/FunctionExplorer';
import ClassExplorer from './components/ClassExplorer';
import DependencyGraphs from './components/DependencyGraphs';
import Statistics from './components/Statistics';
import AppShell from './components/AppShell';
import Icon, { BrandMark } from './components/ui/Icon';
import { ConfirmDialog } from './components/ui/ui';
import './index.css';

const PAGE_LABELS = {
  dashboard: 'Dashboard',
  search: 'Search',
  files: 'File Explorer',
  functions: 'Functions',
  classes: 'Classes',
  graphs: 'Dependency Graphs',
  statistics: 'Statistics',
};

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

  // relativePath is optional; File Explorer falls back to it when fileId is stale after re-indexing
  const handleNavigateToFile = (fileId, startLine, endLine, relativePath) => {
    setFileNavTarget({ fileId, startLine, endLine, relativePath });
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
          {activeTab === 'dashboard' && <Dashboard overview={overview} onNavigate={handleTabNavigate} onNavigateToFile={handleNavigateToFile} />}
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
        <ConfirmDialog
          open={showTabDiscardModal}
          title="Discard unsaved changes?"
          tone="danger"
          confirmLabel="Discard & switch"
          cancelLabel="Keep editing"
          onConfirm={handleConfirmTabDiscard}
          onCancel={handleCancelTabDiscard}
        >
          The editor has unsaved changes. Opening <strong>{PAGE_LABELS[pendingTab] || pendingTab}</strong> will discard them.
        </ConfirmDialog>
      </>
    );
  }

  // Home / upload screen
  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-brand">
          <BrandMark />
          <div>
            <h1 className="home-title">CodeSeek</h1>
            <p className="home-subtitle">Explore, navigate and safely edit Python codebases</p>
          </div>
        </header>

        <main className="home-card">
          <form onSubmit={handleAnalyze}>
            {/* Project name */}
            <div className="field">
              <label htmlFor="name" className="field-label">Project name</label>
              <input
                type="text"
                id="name"
                className="input input-lg"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. sample_shop"
                disabled={loading}
                autoComplete="off"
              />
            </div>

            {/* ZIP file chooser */}
            <div className="field">
              <label htmlFor="zipFile" className="field-label">Repository archive</label>
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
                className={`dropzone${selectedFile ? ' has-file' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                <span className="dropzone-icon">
                  <Icon name={selectedFile ? 'archive' : 'upload'} size={17} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ display: 'block', fontSize: 'var(--cs-text-sm)', fontWeight: 500 }}>
                    {selectedFile ? selectedFile.name : 'Choose a .zip file'}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--cs-text-xs)', color: 'var(--cs-text-subtle)' }}>
                    {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB · click to change` : 'A zipped Python project, extracted and indexed locally'}
                  </span>
                </span>
              </button>
            </div>

            {error && (
              <div className="alert error" role="alert">{error}</div>
            )}

            <button type="submit" disabled={loading || !selectedFile} className="btn-primary btn-lg">
              {loading ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Uploading &amp; analyzing…</> : 'Analyze project'}
            </button>
          </form>
        </main>

        <p className="home-footnote">Code is parsed statically with Python's AST. Nothing in the project is executed.</p>
      </div>
    </div>
  );
}

export default App;

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
  const [name, setName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null); // File object from <input type="file">
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [overview, setOverview] = useState(null);
  const fileInputRef = useRef(null);

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
      <AppShell overview={overview} activeTab={activeTab} onNavigate={setActiveTab} onUpdateOverview={setOverview}>
        {activeTab === 'dashboard' && <Dashboard overview={overview} />}
        {activeTab === 'search' && <Search overview={overview} />}
        {activeTab === 'files' && <FileExplorer overview={overview} />}
        {activeTab === 'functions' && <FunctionExplorer overview={overview} />}
        {activeTab === 'classes' && <ClassExplorer overview={overview} />}
        {activeTab === 'graphs' && <DependencyGraphs overview={overview} />}
        {activeTab === 'statistics' && <Statistics overview={overview} />}
      </AppShell>
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

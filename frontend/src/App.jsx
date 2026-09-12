import { useState } from 'react';
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
  const [directoryPath, setDirectoryPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [overview, setOverview] = useState(null);

  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!name || !directoryPath) {
      setError("Please fill in both fields.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setOverview(null);
    setActiveTab(null);

    try {
      const response = await fetch('http://127.0.0.1:8000/projects/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, directory_path: directoryPath })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Analysis failed");
      }

      const data = await response.json();
      setSuccess(true);
      
      // Fetch overview data
      const overviewRes = await fetch(`http://127.0.0.1:8000/projects/${data.project_id}`);
      if (overviewRes.ok) {
        const overviewData = await overviewRes.json();
        setOverview(overviewData);
        setActiveTab('dashboard'); // Auto navigate to dashboard on success
      }
      
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  };

  // If we have a project loaded and an active tab, render the AppShell
  if (activeTab && overview) {
    return (
      <AppShell overview={overview} activeTab={activeTab} onNavigate={setActiveTab}>
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

  // Otherwise render the home screen
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
            
            <div className="form-group">
              <label htmlFor="directoryPath">Local Directory Path</label>
              <input
                type="text"
                id="directoryPath"
                value={directoryPath}
                onChange={(e) => setDirectoryPath(e.target.value)}
                placeholder="e.g., C:/Projects/my_app"
                disabled={loading}
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Analyzing..." : "Analyze Project"}
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

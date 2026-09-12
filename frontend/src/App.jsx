import { useState } from 'react';
import Dashboard from './components/Dashboard';
import Search from './components/Search';
import './index.css';

function App() {
  const [showDashboard, setShowDashboard] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
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
    setShowDashboard(false);
    setShowSearch(false);

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
      }
      
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  };

  if (showSearch && overview) {
    return (
      <div className="container">
        <header className="header">
          <h1>CodeSeek</h1>
          <p className="subtitle">Explore and understand Python codebases</p>
        </header>
        <main className="main-content">
          <Search overview={overview} onBack={() => setShowSearch(false)} />
        </main>
      </div>
    );
  }

  if (showDashboard && overview) {
    return (
      <div className="container">
        <header className="header">
          <h1>CodeSeek</h1>
          <p className="subtitle">Explore and understand Python codebases</p>
        </header>
        <main className="main-content">
          <Dashboard overview={overview} onSearchClick={() => setShowSearch(true)} onBack={() => setShowDashboard(false)} />
        </main>
      </div>
    );
  }

  return (
    <div className="container">
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

        {success && overview && (
          <div className="alert success">
            <h3>Analysis Complete</h3>
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label">Project ID</span>
                <span className="stat-value">{overview.id}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Files</span>
                <span className="stat-value">{overview.counts.files}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Symbols</span>
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
            <div style={{ marginTop: '1rem' }}>
              <button className="btn-primary" onClick={() => setShowDashboard(true)}>
                Open Dashboard
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

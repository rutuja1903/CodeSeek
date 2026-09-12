import React, { useState } from 'react';
import '../index.css';

function Search({ overview, onBack }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch search results");
      }
      const data = await res.json();
      setResults(data);
      setHasSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ marginTop: 0 }}>Global Search: {overview.name}</h2>
          </div>
          <button className="btn-primary" onClick={onBack}>Back to Dashboard</button>
        </div>
        
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbols, files, imports..."
            style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#222', color: '#fff' }}
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>
      </div>

      {error && (
        <div className="alert error" style={{ marginTop: '1rem' }}>
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      {hasSearched && !loading && !error && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>{results.length} result(s) found</h3>
          
          {results.length === 0 ? (
            <div className="card" style={{ marginTop: '1rem', textAlign: 'center', color: '#888' }}>
              No results found for "{query}"
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
              {results.map((res, index) => (
                <div key={res.id + index} className="card" style={{ padding: '1rem', borderLeft: '4px solid var(--primary-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--primary-color)' }}>{res.name}</span>
                        <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', backgroundColor: '#333', borderRadius: '4px', fontWeight: 'normal' }}>
                          {res.type === 'file' ? 'File' : res.symbol_type}
                        </span>
                      </h4>
                      <div style={{ fontSize: '0.9rem', color: '#aaa', marginBottom: '0.5rem' }}>
                        <div><strong>Path:</strong> {res.relative_path}</div>
                        {res.type === 'symbol' && (
                          <div><strong>Lines:</strong> {res.start_line} - {res.end_line}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
                        {res.score}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#888' }}>Score</div>
                    </div>
                  </div>
                  
                  {res.reasons && res.reasons.length > 0 && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#888' }}>
                      <strong>Matches:</strong> {res.reasons.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Search;

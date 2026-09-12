import React, { useState } from 'react';
import '../index.css';

function Search({ overview }) {
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
    <div className="workspace-view">
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '16px' }}>Global Search</h2>
        
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', maxWidth: '800px', flexDirection: 'row' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbols, files, imports..."
            style={{ 
              flex: 1, 
              padding: '12px 16px', 
              borderRadius: '6px', 
              border: '1px solid var(--border-color)', 
              backgroundColor: 'var(--surface-color)', 
              color: 'var(--text-main)',
              fontSize: '1rem'
            }}
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading} style={{ margin: 0, padding: '0 24px' }}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '16px', maxWidth: '800px' }}>
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      {hasSearched && !loading && !error && (
        <div style={{ maxWidth: '1000px' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '1rem', fontWeight: '500' }}>
            {results.length} result(s) found
          </h3>
          
          {results.length === 0 ? (
             <div style={{ padding: '24px', backgroundColor: 'var(--surface-color)', borderRadius: '8px', color: 'var(--text-muted)', textAlign: 'center' }}>
               No results found for "{query}"
             </div>
          ) : (
             <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
               {results.map((res, index) => (
                 <div key={res.id + index} style={{ 
                   padding: '16px', 
                   backgroundColor: 'var(--surface-color)',
                   border: '1px solid var(--border-color)',
                   borderLeft: '4px solid var(--primary-color)',
                   borderRadius: '6px',
                   display: 'flex',
                   justifyContent: 'space-between',
                 }}>
                    <div style={{ flex: 1, minWidth: 0, paddingRight: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.name}</span>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' }}>
                          {res.type === 'file' ? 'File' : res.symbol_type}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{res.relative_path}</div>
                        {res.type === 'symbol' && (
                          <div style={{ marginTop: '2px' }}>Lines: {res.start_line} - {res.end_line}</div>
                        )}
                      </div>
                      
                      {res.reasons && res.reasons.length > 0 && (
                        <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--primary-color)' }}>
                          Matches: {res.reasons.join(', ')}
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-main)' }}>{res.score}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Score</div>
                    </div>
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

import React, { useState } from 'react';
import Icon from './ui/Icon';
import { PageHeader, Banner, EmptyState, LoadingState } from './ui/ui';
import '../index.css';

const TYPE_ICONS = {
  file: 'file',
  class: 'class',
  method: 'method',
  async_method: 'method',
};

function resultIcon(res) {
  if (res.type === 'file') return 'file';
  return TYPE_ICONS[res.symbol_type] || 'function';
}

function Search({ overview, onNavigateToSymbol, onNavigateToFile }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');

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
      setSearchedQuery(query);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openResult = (res) => {
    if (res.type === 'symbol' && onNavigateToSymbol) {
      onNavigateToSymbol(res.id, res.symbol_type);
    } else if (res.type === 'file' && onNavigateToFile) {
      const match = res.id.match(/^file_(\d+)$/);
      if (match) {
        const fileIdNum = parseInt(match[1], 10);
        onNavigateToFile(fileIdNum, null, null, res.relative_path);
      }
    }
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: '980px' }}>
        <PageHeader
          title="Search"
          description="Weighted search across symbol names, file paths, imports, docstrings and source code."
        />

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }} role="search">
          <div className="input-with-icon" style={{ flex: 1 }}>
            <Icon name="search" size={15} />
            <input
              type="search"
              className="input input-lg"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search functions, classes, files, imports..."
              aria-label="Search query"
              disabled={loading}
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary btn-lg" disabled={loading || !query.trim()}>
            {loading ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : 'Search'}
          </button>
        </form>

        {error && (
          <Banner type="error" boxed title="Search failed.">{error}</Banner>
        )}

        {loading && <LoadingState>Searching...</LoadingState>}

        {!hasSearched && !loading && !error && (
          <EmptyState icon="search" title="Search the indexed project">
            Results are ranked by relevance: exact symbol names score highest, followed by partial
            matches, paths, imports, docstrings and source text. Select a result to open it.
          </EmptyState>
        )}

        {hasSearched && !loading && !error && (
          <section aria-live="polite">
            <h2 className="section-title" style={{ marginBottom: '10px' }}>
              Results <span className="count">{results.length}</span>
            </h2>

            {results.length === 0 ? (
              <EmptyState icon="search" title={`No results for "${searchedQuery}"`}>
                Try a shorter or different term, part of a function or class name, or a file path.
              </EmptyState>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {results.map((res, index) => (
                  <button
                    type="button"
                    key={res.id + index}
                    className="result-row"
                    onClick={() => openResult(res)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: '12px', padding: '10px 14px' }}
                  >
                    <span className="dropzone-icon" style={{ width: '30px', height: '30px', color: res.type === 'file' ? 'var(--cs-cyan)' : 'var(--cs-accent)' }}>
                      <Icon name={resultIcon(res)} size={15} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span className="mono truncate" style={{ fontWeight: 500, fontSize: 'var(--cs-text-sm)' }}>{res.name}</span>
                        <span className="badge">{res.type === 'file' ? 'file' : res.symbol_type?.replace('_', ' ')}</span>
                      </span>
                      <span className="result-row-location truncate">
                        {res.relative_path}{res.type === 'symbol' && res.start_line ? `:${res.start_line}` : ''}
                      </span>
                      {res.reasons && res.reasons.length > 0 && (
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                          {res.reasons.map(reason => (
                            <span key={reason} className="badge badge-plain" style={{ color: 'var(--cs-text-subtle)' }}>{reason}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }} title="Relevance score">
                      <span style={{ fontSize: 'var(--cs-text-md)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{res.score}</span>
                      <span className="subtle" style={{ fontSize: 'var(--cs-text-2xs)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>score</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default Search;

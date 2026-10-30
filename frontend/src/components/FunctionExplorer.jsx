import React, { useState, useEffect, useMemo } from 'react';
import { SymbolInsights, DetailTabs, UnusedFilter, UnusedBadge } from './CodeInsights';
import { usePotentiallyUnused } from './analysisHooks';
import Icon from './ui/Icon';
import { Banner, EmptyState, LoadingState } from './ui/ui';
import '../index.css';

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'references', label: 'References' },
  { id: 'calls', label: 'Call Hierarchy' },
  { id: 'impact', label: 'Impact' },
];

function FunctionExplorer({ overview, onNavigateToFile, symbolNavTarget, clearSymbolNavTarget }) {
  const [symbols, setSymbols] = useState([]);
  const [fileMap, setFileMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [filterQuery, setFilterQuery] = useState('');
  
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [symbolDetails, setSymbolDetails] = useState(null);
  const [sourceSnippet, setSourceSnippet] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Code intelligence: detail tab, and the "potentially unused" list filter
  const [detailTab, setDetailTab] = useState('overview');
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);
  const unused = usePotentiallyUnused(overview.id, showUnusedOnly);

  // Open a result location in the File Explorer (relative path survives re-indexing)
  const handleOpenLocation = (fileId, startLine, endLine, relativePath) => {
    onNavigateToFile(fileId, startLine, endLine, relativePath);
  };

  // Select a related function here; anything else (e.g. a class) opens at its definition
  const handleSelectRelated = (summary) => {
    const match = symbols.find(s => s.deterministic_id === summary.symbol_id);
    if (match) {
      setSelectedSymbol(match);
    } else {
      handleOpenLocation(summary.file_id, summary.start_line, summary.end_line, summary.relative_path);
    }
  };

  useEffect(() => {
    const fetchSymbolsAndFiles = async () => {
      try {
        setLoading(true);
        
        // Fetch files
        const filesRes = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files`);
        if (!filesRes.ok) throw new Error("Failed to fetch files");
        const filesData = await filesRes.json();
        
        const fMap = {};
        filesData.forEach(f => { fMap[f.id] = f; });
        setFileMap(fMap);

        // Fetch symbols
        const symRes = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/symbols`);
        if (!symRes.ok) throw new Error("Failed to fetch symbols");
        const symbolsData = await symRes.json();
        
        // Filter out classes, just keep functions/methods
        const validTypes = ['function', 'async_function', 'nested_function', 'method', 'async_method'];
        const funcs = symbolsData.filter(s => validTypes.includes(s.symbol_type));
        
        // Sort alphabetically by name
        funcs.sort((a, b) => a.name.localeCompare(b.name));
        setSymbols(funcs);

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSymbolsAndFiles();
  }, [overview.id]);

  useEffect(() => {
    if (!selectedSymbol) return;

    const fetchDetails = async () => {
      try {
        setLoadingDetails(true);
        setSourceSnippet(null);
        setSymbolDetails(null);
        
        // 1. Fetch exact symbol details
        const detRes = await fetch(`http://127.0.0.1:8000/symbols/${encodeURIComponent(selectedSymbol.deterministic_id)}`);
        if (!detRes.ok) throw new Error("Failed to fetch symbol details");
        const detData = await detRes.json();
        setSymbolDetails(detData);
        
        // 2. Fetch file source to extract snippet
        const fileRes = await fetch(`http://127.0.0.1:8000/files/${selectedSymbol.file_id}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          if (fileData.source && selectedSymbol.start_line && selectedSymbol.end_line) {
            const lines = fileData.source.split('\n');
            // start_line and end_line are 1-indexed
            const startIdx = Math.max(0, selectedSymbol.start_line - 1);
            const endIdx = Math.min(lines.length, selectedSymbol.end_line);
            setSourceSnippet(lines.slice(startIdx, endIdx).join('\n'));
          } else {
             setSourceSnippet("Source lines not available.");
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingDetails(false);
      }
    };

    fetchDetails();
  }, [selectedSymbol]);

  // Consume navigation target
  useEffect(() => {
    if (symbolNavTarget && !loading) {
      if (symbols.length > 0) {
        const targetSym = symbols.find(s => s.id === symbolNavTarget || s.deterministic_id === symbolNavTarget);
        if (targetSym) {
          setSelectedSymbol(targetSym);
        }
      }
      if (clearSymbolNavTarget) {
        clearSymbolNavTarget();
      }
    }
  }, [symbolNavTarget, symbols, loading, clearSymbolNavTarget]);

  // Frontend filtering and grouping
  const groupedFilteredSymbols = useMemo(() => {
    const q = filterQuery.toLowerCase();
    const filtered = symbols.filter(s => {
      if (showUnusedOnly && !unused.findings?.has(s.deterministic_id)) return false;
      const matchName = s.name.toLowerCase().includes(q);
      const filePath = fileMap[s.file_id]?.relative_path?.toLowerCase() || '';
      const matchPath = filePath.includes(q);
      const parentContext = s.parent_id ? s.parent_id.toLowerCase() : '';
      const matchParent = parentContext.includes(q);
      
      return matchName || matchPath || matchParent;
    });

    const groups = {};
    filtered.forEach(s => {
      const filePath = fileMap[s.file_id]?.relative_path || 'Unknown File';
      if (!groups[filePath]) groups[filePath] = [];
      groups[filePath].push(s);
    });
    
    // Sort files alphabetically
    const sortedGroups = Object.keys(groups).sort().map(key => ({
      file: key,
      symbols: groups[key]
    }));
    return sortedGroups;
  }, [symbols, fileMap, filterQuery, showUnusedOnly, unused.findings]);

  const unusedCount = unused.findings ? symbols.filter(s => unused.findings.has(s.deterministic_id)).length : null;

  const isMethodType = (type) => type === 'method' || type === 'async_method';
  const signature = selectedSymbol
    ? `${selectedSymbol.symbol_type.startsWith('async') ? 'async def' : 'def'} ${selectedSymbol.name}(${(symbolDetails?.parameters || []).join(', ')})`
    : '';

  return (
    <div className="explorer">
      {/* Column 2: Filter & Symbol List */}
      <aside className="explorer-sidebar" aria-label="Functions">
        <div className="explorer-sidebar-header">
          <div className="explorer-sidebar-title">
            <h2 className="section-title"><Icon name="function" size={13} /> Functions</h2>
            {!loading && !error && <span className="badge">{symbols.length}</span>}
          </div>
          <div className="input-with-icon">
            <Icon name="search" size={13} />
            <input
              type="search"
              className="input"
              placeholder="Filter by name, path, parent..."
              aria-label="Filter functions"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
          <UnusedFilter
            active={showUnusedOnly}
            onToggle={() => setShowUnusedOnly(v => !v)}
            unused={unused}
            count={unusedCount}
          />
        </div>
        <div className="explorer-sidebar-body">
          {loading ? (
            <LoadingState>Loading functions...</LoadingState>
          ) : error ? (
            <Banner type="error" boxed>{error}</Banner>
          ) : groupedFilteredSymbols.length === 0 ? (
            <div className="empty-inline" style={{ padding: '16px 12px', textAlign: 'center' }}>
              {showUnusedOnly
                ? (unused.loading ? 'Analyzing project...' : 'No potentially unused functions found.')
                : filterQuery ? 'No functions match this filter.' : 'No functions were found in this project.'}
            </div>
          ) : (
            groupedFilteredSymbols.map(group => (
              <div key={group.file}>
                <div className="list-group-label"><Icon name="file" size={11} /> {group.file}</div>
                {group.symbols.map(sym => {
                  const isSelected = selectedSymbol?.id === sym.id;
                  return (
                    <button
                      key={sym.id}
                      type="button"
                      className={`list-item${isSelected ? ' is-selected' : ''}`}
                      onClick={() => setSelectedSymbol(sym)}
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      <span className="list-item-title">
                        <Icon name={isMethodType(sym.symbol_type) ? 'method' : 'function'} size={13} style={{ color: 'var(--cs-accent)', flexShrink: 0 }} />
                        <span className="mono truncate">{sym.name}</span>
                        {unused.findings?.has(sym.deterministic_id) && <span style={{ marginLeft: 'auto' }}><UnusedBadge /></span>}
                      </span>
                      <span className="list-item-meta">
                        <span>{sym.symbol_type.replace('_', ' ')}</span>
                        {sym.parent_id && <span className="truncate">in {sym.parent_id.split('::').pop()}</span>}
                        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>L{sym.start_line}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Column 3: Details & Source */}
      <section className="explorer-main" aria-label="Function details">
        {!selectedSymbol ? (
          <EmptyState icon="function" title="Select a function">
            Choose a function or method to see its signature and source, where it is referenced,
            its incoming and outgoing calls, and what a change to it may affect.
          </EmptyState>
        ) : (
          <>
            {/* Metadata Header */}
            <div className="detail-header">
              <div className="detail-title-row">
                <div style={{ minWidth: 0 }}>
                  <div className="detail-title">
                    <Icon name={isMethodType(selectedSymbol.symbol_type) ? 'method' : 'function'} size={16} style={{ color: 'var(--cs-accent)', flexShrink: 0 }} />
                    <span className="truncate">{selectedSymbol.name}</span>
                    <span className="badge" style={{ fontFamily: 'var(--cs-font-sans)' }}>{selectedSymbol.symbol_type.replace('_', ' ')}</span>
                  </div>
                  <div className="detail-id">{selectedSymbol.deterministic_id}</div>
                </div>
                {selectedSymbol.file_id && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleOpenLocation(selectedSymbol.file_id, selectedSymbol.start_line, selectedSymbol.end_line, fileMap[selectedSymbol.file_id]?.relative_path)}
                    title="Open this definition in the File Explorer"
                  >
                    <Icon name="arrowUpRight" size={13} /> Open in editor
                  </button>
                )}
              </div>

              <div className="meta-grid">
                <div className="meta-item">
                  <span>File</span>
                  <span>{fileMap[selectedSymbol.file_id]?.relative_path || 'Unknown'}</span>
                </div>
                <div className="meta-item">
                  <span>Lines</span>
                  <span>{selectedSymbol.start_line} – {selectedSymbol.end_line}</span>
                </div>
                {selectedSymbol.parent_id && (
                  <div className="meta-item">
                    <span>Context</span>
                    <span>{selectedSymbol.parent_id.split('::').pop()}</span>
                  </div>
                )}
              </div>
            </div>

            <DetailTabs tabs={DETAIL_TABS} active={detailTab} onChange={setDetailTab} />

            {detailTab !== 'overview' ? (
              <SymbolInsights
                key={`${selectedSymbol.deterministic_id}:${detailTab}`}
                projectId={overview.id}
                symbolId={selectedSymbol.deterministic_id}
                view={detailTab}
                onOpenLocation={handleOpenLocation}
                onSelectSymbol={handleSelectRelated}
              />
            ) : (
              <div className="detail-body">
                {loadingDetails ? (
                  <LoadingState>Loading details...</LoadingState>
                ) : (
                  <>
                    {/* Signature */}
                    {symbolDetails && (
                      <div>
                        <h3 className="section-title" style={{ marginBottom: '8px' }}>Signature</h3>
                        <code className="code-block" style={{ display: 'block', padding: '10px 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {signature}
                        </code>
                      </div>
                    )}

                    {/* Docstring */}
                    {symbolDetails?.docstring && (
                      <div>
                        <h3 className="section-title" style={{ marginBottom: '8px' }}>Docstring</h3>
                        <div style={{ padding: '10px 14px', borderLeft: '2px solid var(--cs-accent)', background: 'var(--cs-bg-2)', borderRadius: '0 var(--cs-radius) var(--cs-radius) 0', color: 'var(--cs-text)', whiteSpace: 'pre-wrap', fontSize: 'var(--cs-text-sm)', lineHeight: 1.6 }}>
                          {symbolDetails.docstring}
                        </div>
                      </div>
                    )}

                    {/* Source Snippet */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                      <h3 className="section-title" style={{ marginBottom: '8px' }}>Source</h3>
                      {sourceSnippet ? (
                        <div className="code-block" style={{ flex: 1 }}>
                          {sourceSnippet.split('\n').map((line, idx) => {
                            const lineNum = typeof selectedSymbol.start_line === 'number'
                              ? Math.max(1, selectedSymbol.start_line) + idx
                              : '';
                            return (
                              <div key={idx} className="code-line">
                                <span className="code-line-number">{lineNum}</span>
                                <span className="code-line-text">{line === '' ? ' ' : line}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="empty-inline">Source snippet not available.</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default FunctionExplorer;

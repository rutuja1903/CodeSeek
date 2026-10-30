import React, { useState, useEffect, useMemo } from 'react';
import { SymbolInsights, DetailTabs, UnusedFilter, UnusedBadge } from './CodeInsights';
import { usePotentiallyUnused } from './analysisHooks';
import Icon from './ui/Icon';
import { Banner, EmptyState, LoadingState } from './ui/ui';
import '../index.css';

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'references', label: 'References' },
  { id: 'impact', label: 'Impact' },
];

function ClassExplorer({ overview, onNavigateToFile, symbolNavTarget, clearSymbolNavTarget }) {
  const [symbols, setSymbols] = useState([]);
  const [allMethods, setAllMethods] = useState([]);
  const [fileMap, setFileMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [filterQuery, setFilterQuery] = useState('');
  
  const [selectedClass, setSelectedClass] = useState(null);
  const [classDetails, setClassDetails] = useState(null);
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

  // Select a related class here; anything else (e.g. a method) opens at its definition
  const handleSelectRelated = (summary) => {
    const match = symbols.find(s => s.deterministic_id === summary.symbol_id);
    if (match) {
      setSelectedClass(match);
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
        
        // Filter out classes and methods
        const classes = symbolsData.filter(s => s.symbol_type === 'class');
        const methods = symbolsData.filter(s => s.symbol_type === 'method' || s.symbol_type === 'async_method');
        
        // Sort alphabetically by name
        classes.sort((a, b) => a.name.localeCompare(b.name));
        setSymbols(classes);
        setAllMethods(methods);

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSymbolsAndFiles();
  }, [overview.id]);

  useEffect(() => {
    if (!selectedClass) return;

    const fetchDetails = async () => {
      try {
        setLoadingDetails(true);
        setSourceSnippet(null);
        setClassDetails(null);
        
        // 1. Fetch exact symbol details
        const detRes = await fetch(`http://127.0.0.1:8000/symbols/${encodeURIComponent(selectedClass.deterministic_id)}`);
        if (!detRes.ok) throw new Error("Failed to fetch symbol details");
        const detData = await detRes.json();
        setClassDetails(detData);
        
        // 2. Fetch file source to extract snippet
        const fileRes = await fetch(`http://127.0.0.1:8000/files/${selectedClass.file_id}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          if (fileData.source && selectedClass.start_line && selectedClass.end_line) {
            const lines = fileData.source.split('\n');
            // start_line and end_line are 1-indexed
            const startIdx = Math.max(0, selectedClass.start_line - 1);
            const endIdx = Math.min(lines.length, selectedClass.end_line);
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
  }, [selectedClass]);

  // Consume navigation target
  useEffect(() => {
    if (symbolNavTarget && !loading) {
      if (symbols.length > 0) {
        const targetSym = symbols.find(s => s.id === symbolNavTarget || s.deterministic_id === symbolNavTarget);
        if (targetSym) {
          setSelectedClass(targetSym);
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
      
      // Note: We cannot filter by 'bases' (base classes) accurately here because the base class array
      // is only returned in the /symbols/{id} detail endpoint, not the bulk list endpoint.
      // We will match against parent_id context if it exists.
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
      classes: groups[key]
    }));
    return sortedGroups;
  }, [symbols, fileMap, filterQuery, showUnusedOnly, unused.findings]);

  const unusedCount = unused.findings ? symbols.filter(s => unused.findings.has(s.deterministic_id)).length : null;

  // Identify methods belonging to the currently selected class
  const selectedClassMethods = useMemo(() => {
    if (!selectedClass) return [];
    return allMethods.filter(m => m.parent_id === selectedClass.deterministic_id);
  }, [selectedClass, allMethods]);

  return (
    <div className="explorer">
      {/* Column 2: Filter & Class List */}
      <aside className="explorer-sidebar" aria-label="Classes">
        <div className="explorer-sidebar-header">
          <div className="explorer-sidebar-title">
            <h2 className="section-title"><Icon name="class" size={13} /> Classes</h2>
            {!loading && !error && <span className="badge">{symbols.length}</span>}
          </div>
          <div className="input-with-icon">
            <Icon name="search" size={13} />
            <input
              type="search"
              className="input"
              placeholder="Filter by name, path..."
              aria-label="Filter classes"
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
            <LoadingState>Loading classes...</LoadingState>
          ) : error ? (
            <Banner type="error" boxed>{error}</Banner>
          ) : groupedFilteredSymbols.length === 0 ? (
            <div className="empty-inline" style={{ padding: '16px 12px', textAlign: 'center' }}>
              {showUnusedOnly
                ? (unused.loading ? 'Analyzing project...' : 'No potentially unused classes found.')
                : filterQuery ? 'No classes match this filter.' : 'No classes were found in this project.'}
            </div>
          ) : (
            groupedFilteredSymbols.map(group => (
              <div key={group.file}>
                <div className="list-group-label"><Icon name="file" size={11} /> {group.file}</div>
                {group.classes.map(cls => {
                  const isSelected = selectedClass?.id === cls.id;
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      className={`list-item${isSelected ? ' is-selected' : ''}`}
                      onClick={() => setSelectedClass(cls)}
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      <span className="list-item-title">
                        <Icon name="class" size={13} style={{ color: 'var(--cs-cyan)', flexShrink: 0 }} />
                        <span className="mono truncate">{cls.name}</span>
                        {unused.findings?.has(cls.deterministic_id) && <span style={{ marginLeft: 'auto' }}><UnusedBadge /></span>}
                      </span>
                      <span className="list-item-meta">
                        <span>class</span>
                        {cls.parent_id && <span className="truncate">in {cls.parent_id.split('::').pop()}</span>}
                        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>L{cls.start_line}</span>
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
      <section className="explorer-main" aria-label="Class details">
        {!selectedClass ? (
          <EmptyState icon="class" title="Select a class">
            Choose a class to see its methods, base classes and source, where it is referenced or
            subclassed, and what a change to it may affect.
          </EmptyState>
        ) : (
          <>
            {/* Metadata Header */}
            <div className="detail-header">
              <div className="detail-title-row">
                <div style={{ minWidth: 0 }}>
                  <div className="detail-title">
                    <Icon name="class" size={16} style={{ color: 'var(--cs-cyan)', flexShrink: 0 }} />
                    <span className="truncate">{selectedClass.name}</span>
                    <span className="badge" style={{ fontFamily: 'var(--cs-font-sans)' }}>class</span>
                  </div>
                  <div className="detail-id">{selectedClass.deterministic_id}</div>
                </div>
                {selectedClass.file_id && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleOpenLocation(selectedClass.file_id, selectedClass.start_line, selectedClass.end_line, fileMap[selectedClass.file_id]?.relative_path)}
                    title="Open this definition in the File Explorer"
                  >
                    <Icon name="arrowUpRight" size={13} /> Open in editor
                  </button>
                )}
              </div>

              <div className="meta-grid">
                <div className="meta-item">
                  <span>File</span>
                  <span>{fileMap[selectedClass.file_id]?.relative_path || 'Unknown'}</span>
                </div>
                <div className="meta-item">
                  <span>Lines</span>
                  <span>{selectedClass.start_line} – {selectedClass.end_line}</span>
                </div>
                {selectedClass.parent_id && (
                  <div className="meta-item">
                    <span>Context</span>
                    <span>{selectedClass.parent_id.split('::').pop()}</span>
                  </div>
                )}
                {/* Inheritance from details payload if available */}
                {classDetails && (
                  <div className="meta-item">
                    <span>Inherits from</span>
                    <span style={{ color: classDetails.bases?.length ? 'var(--cs-accent)' : 'var(--cs-text-subtle)' }}>
                      {classDetails.bases && classDetails.bases.length > 0
                         ? classDetails.bases.join(', ')
                         : 'No base classes'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <DetailTabs tabs={DETAIL_TABS} active={detailTab} onChange={setDetailTab} />

            {detailTab !== 'overview' ? (
              <SymbolInsights
                key={`${selectedClass.deterministic_id}:${detailTab}`}
                projectId={overview.id}
                symbolId={selectedClass.deterministic_id}
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
                    {/* Docstring */}
                    {classDetails?.docstring && (
                      <div>
                        <h3 className="section-title" style={{ marginBottom: '8px' }}>Docstring</h3>
                        <div style={{ padding: '10px 14px', borderLeft: '2px solid var(--cs-accent)', background: 'var(--cs-bg-2)', borderRadius: '0 var(--cs-radius) var(--cs-radius) 0', color: 'var(--cs-text)', whiteSpace: 'pre-wrap', fontSize: 'var(--cs-text-sm)', lineHeight: 1.6 }}>
                          {classDetails.docstring}
                        </div>
                      </div>
                    )}

                    {/* Class Methods */}
                    <div>
                      <h3 className="section-title" style={{ marginBottom: '8px' }}>
                        Methods <span className="count">{selectedClassMethods.length}</span>
                      </h3>
                      {selectedClassMethods.length === 0 ? (
                        <div className="empty-inline">This class defines no methods.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {selectedClassMethods.map(method => (
                            <button
                              key={method.id}
                              type="button"
                              className="result-row"
                              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px' }}
                              onClick={() => handleOpenLocation(method.file_id, method.start_line, method.end_line, fileMap[method.file_id]?.relative_path)}
                              title="Open this method in the File Explorer"
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                <Icon name="method" size={13} style={{ color: 'var(--cs-accent)', flexShrink: 0 }} />
                                <span className="mono truncate" style={{ fontSize: 'var(--cs-text-sm)' }}>{method.name}</span>
                              </span>
                              <span className="result-row-location">L{method.start_line}–{method.end_line}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Source Snippet */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                      <h3 className="section-title" style={{ marginBottom: '8px' }}>Source</h3>
                      {sourceSnippet ? (
                        <div className="code-block" style={{ flex: 1 }}>
                          {sourceSnippet.split('\n').map((line, idx) => {
                            const lineNum = typeof selectedClass.start_line === 'number'
                              ? Math.max(1, selectedClass.start_line) + idx
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

export default ClassExplorer;

import React, { useState, useEffect, useMemo } from 'react';
import '../index.css';

function ClassExplorer({ overview }) {
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

  // Frontend filtering and grouping
  const groupedFilteredSymbols = useMemo(() => {
    const q = filterQuery.toLowerCase();
    const filtered = symbols.filter(s => {
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
  }, [symbols, fileMap, filterQuery]);

  // Identify methods belonging to the currently selected class
  const selectedClassMethods = useMemo(() => {
    if (!selectedClass) return [];
    return allMethods.filter(m => m.parent_id === selectedClass.deterministic_id);
  }, [selectedClass, allMethods]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Column 2: Filter & Class List */}
      <div style={{ 
        width: '320px', 
        borderRight: '1px solid var(--border-color)', 
        display: 'flex', 
        flexDirection: 'column',
        backgroundColor: 'var(--surface-color)',
        flexShrink: 0
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600 }}>Class Explorer</h3>
          <input
            type="text"
            placeholder="Filter by name, path..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '8px 12px', 
              borderRadius: '4px', 
              border: '1px solid var(--border-color)', 
              backgroundColor: 'var(--bg-color)', 
              color: 'var(--text-main)',
              fontSize: '0.9rem'
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading classes...</p>
          ) : error ? (
            <p className="alert error">{error}</p>
          ) : (
            groupedFilteredSymbols.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '24px' }}>No classes match.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {groupedFilteredSymbols.map(group => (
                  <div key={group.file}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, wordBreak: 'break-all' }}>
                      {group.file}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {group.classes.map(cls => (
                        <div
                          key={cls.id}
                          onClick={() => setSelectedClass(cls)}
                          style={{
                            padding: '8px 12px',
                            backgroundColor: selectedClass?.id === cls.id ? 'var(--primary-color)' : 'var(--bg-color)',
                            border: '1px solid',
                            borderColor: selectedClass?.id === cls.id ? 'var(--primary-color)' : 'var(--border-color)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            color: selectedClass?.id === cls.id ? '#fff' : 'var(--text-main)',
                            transition: 'background-color 0.1s'
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cls.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.8, display: 'flex', justifyContent: 'space-between' }}>
                            <span>class</span>
                            <span>Line {cls.start_line}</span>
                          </div>
                          {cls.parent_id && (
                            <div style={{ fontSize: '0.7rem', marginTop: '4px', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              Context: {cls.parent_id.split('::').pop()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Column 3: Details & Source */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-color)' }}>
        {!selectedClass ? (
           <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
             Select a class to view details
           </div>
        ) : (
           <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
             
             {/* Metadata Header */}
             <div style={{ 
               padding: '16px 24px', 
               borderBottom: '1px solid var(--border-color)', 
               backgroundColor: 'var(--surface-color)',
               flexShrink: 0
             }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                 <div>
                   <h2 style={{ margin: '0 0 8px 0', fontSize: '1.4rem' }}>{selectedClass.name}</h2>
                   <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{selectedClass.deterministic_id}</div>
                 </div>
                 <div style={{ padding: '4px 12px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '16px', fontSize: '0.85rem', fontWeight: 600 }}>
                   class
                 </div>
               </div>

               <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', color: 'var(--text-main)', flexWrap: 'wrap' }}>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>File</span>
                   <span>{fileMap[selectedClass.file_id]?.relative_path || 'Unknown'}</span>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column' }}>
                   <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Lines</span>
                   <span>{selectedClass.start_line} - {selectedClass.end_line}</span>
                 </div>
                 {selectedClass.parent_id && (
                   <div style={{ display: 'flex', flexDirection: 'column' }}>
                     <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Context</span>
                     <span>{selectedClass.parent_id.split('::').pop()}</span>
                   </div>
                 )}
                 {/* Inheritance from details payload if available */}
                 {classDetails && (
                   <div style={{ display: 'flex', flexDirection: 'column' }}>
                     <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Inheritance</span>
                     <span style={{ color: 'var(--primary-color)' }}>
                       {classDetails.bases && classDetails.bases.length > 0 
                          ? classDetails.bases.join(', ') 
                          : 'No base classes'}
                     </span>
                   </div>
                 )}
               </div>
             </div>

             <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {loadingDetails ? (
                  <p style={{ color: 'var(--text-muted)' }}>Loading details...</p>
                ) : (
                  <>
                    {/* Docstring */}
                    {classDetails?.docstring && (
                      <div>
                        <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.8rem' }}>Docstring</h4>
                        <div style={{ 
                          padding: '12px 16px', 
                          backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                          borderLeft: '4px solid var(--primary-color)',
                          color: '#e2e8f0',
                          whiteSpace: 'pre-wrap',
                          fontSize: '0.95rem'
                        }}>
                          {classDetails.docstring}
                        </div>
                      </div>
                    )}

                    {/* Class Methods */}
                    {selectedClassMethods.length > 0 && (
                      <div>
                        <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.8rem' }}>Methods</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {selectedClassMethods.map(method => (
                            <div key={method.id} style={{ 
                              padding: '12px', 
                              backgroundColor: 'var(--surface-color)', 
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                                {method.name}
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Line {method.start_line} - {method.end_line}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Source Snippet */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.8rem' }}>Source Code</h4>
                      <div style={{ flex: 1, backgroundColor: '#1e1e1e', padding: '16px', borderRadius: '6px', overflow: 'auto' }}>
                        {sourceSnippet ? (
                          <pre style={{ margin: 0, width: 'fit-content', minWidth: '100%' }}>
                            <code style={{ 
                              fontFamily: 'monospace', 
                              fontSize: '0.95rem', 
                              color: 'var(--text-main)', 
                              whiteSpace: 'pre'
                            }}>
                              {sourceSnippet}
                            </code>
                          </pre>
                        ) : (
                          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>Snippet not available.</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
             </div>
           </div>
        )}
      </div>
    </div>
  );
}

export default ClassExplorer;

import React, { useState, useEffect, useCallback } from 'react';
import CodeEditor from './CodeEditor';
import '../index.css';

const TreeNode = ({ node, onSelect, selectedId }) => {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <div style={{ paddingLeft: node.name === 'root' ? '0' : '1.2rem' }}>
      {node.name !== 'root' && (
        <div 
          onClick={() => setExpanded(!expanded)} 
          style={{ cursor: 'pointer', fontWeight: 'bold', color: '#ccc', padding: '4px 0', userSelect: 'none' }}
        >
          {expanded ? '📂' : '📁'} {node.name}
        </div>
      )}
      {expanded && (
        <div>
          {Object.values(node.children).map(child => (
            <TreeNode key={child.name} node={child} onSelect={onSelect} selectedId={selectedId} />
          ))}
          {node.files.map(file => (
            <div 
              key={file.id} 
              onClick={() => onSelect(file)}
              style={{ 
                cursor: 'pointer', 
                padding: '4px 8px', 
                color: file.parse_status ? '#ddd' : 'var(--error-text)',
                backgroundColor: selectedId === file.id ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                borderRadius: '4px',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={file.relative_path.split('/').pop()}
            >
              <span style={{ fontSize: '0.9rem' }}>📄</span> 
              <span>{file.relative_path.split('/').pop()}</span>
              {!file.parse_status && <span style={{ color: 'var(--error-text)', fontSize: '0.8rem' }}>⚠️</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function FileExplorer({ 
  overview, 
  fileNavTarget, 
  clearNavTarget,
  onDirtyChange,
  onUpdateOverview
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  const [highlightRange, setHighlightRange] = useState(null);

  // Editor, validation, and save states
  const [editorSource, setEditorSource] = useState('');
  const [savedSource, setSavedSource] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saveBanner, setSaveBanner] = useState(null);

  // Discard guard modal states
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [pendingFileSwitch, setPendingFileSwitch] = useState(null);

  // Derived dirty state
  const isDirty = Boolean(selectedFile && editorSource !== savedSource);

  // Sync dirty state upwards to parent (App.jsx)
  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  // Window beforeunload guard to protect against browser tab close / reload
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Fetch file list
  const fetchFiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files`);
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      data.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
      setFiles(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [overview.id]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Consume navigation target from Search / Functions / Classes
  useEffect(() => {
    if (fileNavTarget && files.length > 0) {
      const targetFile = files.find(f => f.id === fileNavTarget.fileId);
      if (targetFile) {
        if (isDirty && selectedFile && selectedFile.id !== targetFile.id) {
          setPendingFileSwitch(targetFile);
          setShowDiscardModal(true);
        } else {
          setSelectedFile(targetFile);
          if (fileNavTarget.startLine > 0 && fileNavTarget.endLine >= fileNavTarget.startLine) {
            setHighlightRange({
              start: fileNavTarget.startLine,
              end: fileNavTarget.endLine
            });
          } else {
            setHighlightRange(null);
          }
        }
      }
      if (clearNavTarget) {
        clearNavTarget();
      }
    }
  }, [fileNavTarget, files, clearNavTarget, isDirty, selectedFile]);

  // Fetch file details when selectedFile changes
  useEffect(() => {
    if (!selectedFile) return;

    let isMounted = true;
    const fetchDetails = async () => {
      try {
        setLoadingDetails(true);
        const res = await fetch(`http://127.0.0.1:8000/files/${selectedFile.id}`);
        if (!res.ok) throw new Error("Failed to fetch file details");
        const data = await res.json();
        if (isMounted) {
          const src = data.source || '';
          setEditorSource(src);
          setSavedSource(src);
          setSaveBanner(null);
          setValidationResult(null);
        }
      } catch (err) {
        console.error("Error fetching file details:", err);
      } finally {
        if (isMounted) {
          setLoadingDetails(false);
        }
      }
    };

    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [selectedFile?.id]);

  // Debounced Syntax Validation
  useEffect(() => {
    if (!selectedFile || !selectedFile.relative_path.toLowerCase().endsWith('.py')) {
      setValidationResult(null);
      return;
    }

    setIsValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: editorSource,
            relative_path: selectedFile.relative_path,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setValidationResult(data);
        } else {
          setValidationResult(null);
        }
      } catch {
        setValidationResult(null);
      } finally {
        setIsValidating(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [editorSource, selectedFile, overview.id]);

  // File selection with unsaved changes guard
  const handleSelectFile = (file) => {
    if (selectedFile && file.id === selectedFile.id) return;

    if (isDirty) {
      setPendingFileSwitch(file);
      setShowDiscardModal(true);
    } else {
      setSelectedFile(file);
      setHighlightRange(null);
      setSaveBanner(null);
    }
  };

  // Discard confirmation
  const handleConfirmDiscard = () => {
    setEditorSource(savedSource);
    setShowDiscardModal(false);
    if (pendingFileSwitch) {
      setSelectedFile(pendingFileSwitch);
      setPendingFileSwitch(null);
      setHighlightRange(null);
      setSaveBanner(null);
    }
  };

  const handleCancelDiscard = () => {
    setShowDiscardModal(false);
    setPendingFileSwitch(null);
  };

  // Manual Discard/Revert button
  const handleManualDiscard = () => {
    setEditorSource(savedSource);
    setSaveBanner(null);
  };

  // Save handler
  const handleSave = async () => {
    if (!selectedFile || isSaving) return;

    setIsSaving(true);
    setSaveBanner(null);

    try {
      const response = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relative_path: selectedFile.relative_path,
          source: editorSource,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 200) {
        // Full Success: persisted on disk and project re-indexed
        setSavedSource(editorSource);
        setSaveBanner({
          type: 'success',
          message: data.message || 'File saved and project re-indexed successfully.',
        });

        // Refresh file list and update selectedFile with fresh new_file_id
        const freshFiles = await fetchFiles();
        if (data.new_file_id) {
          const freshSelected = freshFiles.find(f => f.id === data.new_file_id);
          if (freshSelected) {
            setSelectedFile(freshSelected);
          } else {
            setSelectedFile(prev => ({ ...prev, id: data.new_file_id }));
          }
        }

        // Refresh overview counts across application
        try {
          const ovRes = await fetch(`http://127.0.0.1:8000/projects/${overview.id}`);
          if (ovRes.ok) {
            const freshOverview = await ovRes.json();
            if (onUpdateOverview) {
              onUpdateOverview(freshOverview);
            }
          }
        } catch (ovErr) {
          console.error("Failed to refresh overview:", ovErr);
        }

      } else if (response.status === 207) {
        // HTTP 207 Multi-Status Partial Success: File written to disk, but re-indexing or lookup failed
        setSavedSource(editorSource); // The file was written to disk! Baseline is updated.
        setSaveBanner({
          type: 'warning',
          message: data.message || 'File saved to disk, but re-indexing failed.',
          detail: data.detail || (data.status === 'reindex_missing_file' ? 'File record could not be confirmed in the index.' : 'AST/graphs may be stale until re-indexed.'),
        });

      } else {
        // Ordinary HTTP error (400, 403, 500)
        setSaveBanner({
          type: 'error',
          message: data.detail || `Save failed (HTTP ${response.status})`,
        });
      }
    } catch (err) {
      // Network error -- keep edits and baseline unchanged
      setSaveBanner({
        type: 'error',
        message: `Network error: ${err.message || 'Could not connect to backend'}. Local edits are preserved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Build tree from files
  const treeRoot = { name: 'root', children: {}, files: [] };
  files.forEach(file => {
    const parts = file.relative_path.split('/');
    parts.pop();
    let current = treeRoot;
    parts.forEach(part => {
      if (!current.children[part]) {
        current.children[part] = { name: part, children: {}, files: [] };
      }
      current = current.children[part];
    });
    current.files.push(file);
  });

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Column 2: File Tree */}
      <div style={{ 
        width: '300px', 
        borderRight: '1px solid var(--border-color)', 
        display: 'flex', 
        flexDirection: 'column',
        backgroundColor: 'var(--surface-color)',
        flexShrink: 0
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}>
          Project Files
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '12px' }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading files...</p>
          ) : error ? (
            <p className="alert error">{error}</p>
          ) : (
            <TreeNode 
              node={treeRoot} 
              onSelect={handleSelectFile} 
              selectedId={selectedFile?.id} 
            />
          )}
        </div>
      </div>

      {/* Column 3: Editor & Controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-color)' }}>
        {!selectedFile ? (
           <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
             Select a file to view and edit code
           </div>
        ) : (
           <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
             {/* 1. Header Toolbar */}
             <div style={{ 
               padding: '12px 20px', 
               borderBottom: '1px solid var(--border-color)', 
               backgroundColor: 'var(--surface-color)',
               display: 'flex',
               justifyContent: 'space-between',
               alignItems: 'center',
               fontSize: '0.875rem',
               flexShrink: 0,
               gap: '16px',
             }}>
               {/* Left: File Metadata & Badges */}
               <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                 <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>{selectedFile.relative_path}</div>
                 <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                   Lines: {editorSource.split('\n').length}
                 </div>

                 {/* Dirty Status Badge */}
                 {isDirty ? (
                   <span style={{ 
                     display: 'inline-flex', 
                     alignItems: 'center', 
                     gap: '6px',
                     padding: '2px 8px', 
                     borderRadius: '12px', 
                     fontSize: '0.75rem',
                     backgroundColor: 'rgba(245, 158, 11, 0.15)',
                     color: '#f59e0b',
                     fontWeight: '600'
                   }}>
                     ● Unsaved Changes
                   </span>
                 ) : (
                   <span style={{ 
                     display: 'inline-flex', 
                     alignItems: 'center', 
                     gap: '4px',
                     padding: '2px 8px', 
                     borderRadius: '12px', 
                     fontSize: '0.75rem',
                     backgroundColor: 'rgba(16, 185, 129, 0.15)',
                     color: 'var(--success-text)',
                   }}>
                     ✓ Saved
                   </span>
                 )}

                 {/* Syntax Validation Badge */}
                 {isValidating ? (
                   <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>⟳ Validating...</span>
                 ) : validationResult ? (
                   validationResult.valid ? (
                     <span style={{ fontSize: '0.75rem', color: 'var(--success-text)' }}>✓ Syntax Valid</span>
                   ) : (
                     <span style={{ fontSize: '0.75rem', color: 'var(--error-text)', fontWeight: '600' }}>
                       ⚠️ Syntax Error (Line {validationResult.errors?.[0]?.line || '?'})
                     </span>
                   )
                 ) : null}
               </div>

               {/* Right: Action Buttons */}
               <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                 <button
                   type="button"
                   onClick={handleManualDiscard}
                   disabled={!isDirty || isSaving}
                   style={{
                     padding: '6px 12px',
                     borderRadius: '6px',
                     border: '1px solid var(--border-color)',
                     backgroundColor: 'transparent',
                     color: isDirty ? 'var(--text-main)' : 'var(--text-muted)',
                     cursor: isDirty && !isSaving ? 'pointer' : 'not-allowed',
                     fontSize: '0.8rem',
                   }}
                 >
                   Discard
                 </button>

                 <button
                   type="button"
                   onClick={handleSave}
                   disabled={isSaving}
                   className="btn-primary"
                   style={{
                     margin: 0,
                     padding: '6px 16px',
                     fontSize: '0.85rem',
                     fontWeight: '600',
                     cursor: isSaving ? 'wait' : 'pointer',
                   }}
                 >
                   {isSaving ? 'Saving...' : 'Save (Ctrl+S)'}
                 </button>
               </div>
             </div>

             {/* 2. Feedback Banners */}
             {saveBanner && (
               <div 
                 style={{ 
                   padding: '10px 20px', 
                   display: 'flex', 
                   justifyContent: 'space-between',
                   alignItems: 'center',
                   fontSize: '0.85rem',
                   backgroundColor: saveBanner.type === 'success' 
                     ? 'var(--success-bg)' 
                     : saveBanner.type === 'warning' 
                     ? '#78350f' 
                     : 'var(--error-bg)',
                   color: saveBanner.type === 'success' 
                     ? 'var(--success-text)' 
                     : saveBanner.type === 'warning' 
                     ? '#fde68a' 
                     : 'var(--error-text)',
                   borderBottom: `1px solid ${
                     saveBanner.type === 'success' 
                       ? 'var(--success-border)' 
                       : saveBanner.type === 'warning' 
                       ? '#b45309' 
                       : 'var(--error-border)'
                   }`,
                   flexShrink: 0,
                 }}
               >
                 <div>
                   <strong>{saveBanner.type === 'success' ? 'Success:' : saveBanner.type === 'warning' ? 'Warning:' : 'Error:'}</strong>{' '}
                   {saveBanner.message}
                   {saveBanner.detail && <div style={{ fontSize: '0.78rem', marginTop: '2px', opacity: 0.9 }}>{saveBanner.detail}</div>}
                 </div>
                 <button 
                   type="button" 
                   onClick={() => setSaveBanner(null)}
                   style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
                 >
                   ✕
                 </button>
               </div>
             )}

             {/* Syntax Validation Error Detail Banner */}
             {validationResult && !validationResult.valid && validationResult.errors?.[0] && (
               <div 
                 style={{ 
                   padding: '8px 20px', 
                   backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                   borderBottom: '1px solid rgba(239, 68, 68, 0.25)', 
                   color: '#fca5a5', 
                   fontSize: '0.8rem',
                   flexShrink: 0,
                 }}
               >
                 <strong>Syntax Error:</strong> Line {validationResult.errors[0].line}: {validationResult.errors[0].message}
                 {validationResult.errors[0].text && (
                   <span style={{ marginLeft: '12px', fontFamily: 'monospace', opacity: 0.85 }}>
                     "{validationResult.errors[0].text}"
                   </span>
                 )}
               </div>
             )}

             {/* 3. Code Editor */}
             <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
               {loadingDetails ? (
                 <div style={{ padding: '24px', color: 'var(--text-muted)' }}>Loading source code...</div>
               ) : (
                 <CodeEditor
                   value={editorSource}
                   onChange={setEditorSource}
                   onSave={handleSave}
                   highlightRange={highlightRange}
                 />
               )}
             </div>
           </div>
        )}
      </div>

      {/* Discard Confirmation Modal */}
      {showDiscardModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '460px',
            width: '90%',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: 'var(--text-main)' }}>
              Unsaved Changes
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
              You have unsaved changes in <strong style={{ color: 'var(--text-main)' }}>{selectedFile?.relative_path}</strong>. 
              Discard changes and open {pendingFileSwitch ? <strong style={{ color: 'var(--text-main)' }}>{pendingFileSwitch.relative_path}</strong> : 'another file'}?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={handleCancelDiscard}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                }}
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileExplorer;

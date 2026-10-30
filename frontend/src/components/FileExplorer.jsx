import React, { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef } from 'react';
import CodeEditor from './CodeEditor';
import DiffView from './DiffView';
import HistoryView from './HistoryView';
import { FileImpactView } from './CodeInsights';
import Icon from './ui/Icon';
import { Banner, ConfirmDialog, EmptyState, LoadingState } from './ui/ui';
import { diffLines, lineMarkers, revertHunk } from '../utils/lineDiff';
import '../index.css';

// Indentation for a tree row at a given depth
const treeIndent = (depth) => ({ paddingLeft: `${8 + depth * 14}px` });

const TreeNode = ({ node, onSelect, selectedId, depth = 0 }) => {
  const [expanded, setExpanded] = useState(true);
  const isRoot = node.name === 'root';
  const childDepth = isRoot ? depth : depth + 1;

  return (
    <div>
      {!isRoot && (
        <button
          type="button"
          className="tree-row is-folder"
          style={treeIndent(depth)}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <Icon name="chevronRight" size={12} className={`chevron${expanded ? ' open' : ''}`} />
          <Icon name={expanded ? 'folderOpen' : 'folder'} size={14} className="folder-icon" />
          <span className="truncate">{node.name}</span>
        </button>
      )}
      {expanded && (
        <div>
          {Object.values(node.children).map(child => (
            <TreeNode key={child.name} node={child} onSelect={onSelect} selectedId={selectedId} depth={childDepth} />
          ))}
          {node.files.map(file => {
            const fileName = file.relative_path.split('/').pop();
            const isSelected = selectedId === file.id;
            return (
              <button
                key={file.id}
                type="button"
                onClick={() => onSelect(file)}
                className={`tree-row${isSelected ? ' is-selected' : ''}${!file.parse_status ? ' has-error' : ''}`}
                style={treeIndent(childDepth)}
                aria-current={isSelected ? 'true' : undefined}
                title={file.parse_status ? file.relative_path : `${file.relative_path} (failed to parse)`}
              >
                <span style={{ width: '12px', flexShrink: 0 }} />
                <Icon name="file" size={14} className="file-icon" />
                <span className="truncate">{fileName}</span>
                {!file.parse_status && <Icon name="alertCircle" size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
              </button>
            );
          })}
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
  const [pendingHighlight, setPendingHighlight] = useState(null);

  // Editor, unsaved-changes (diff) or version history view
  const [viewMode, setViewMode] = useState('editor');

  // Version history: restore in flight, and a counter that reloads the version list
  const [isRestoring, setIsRestoring] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Set to the new file id after a successful save, so the details reload for that id
  // keeps the editor buffer (including anything typed while the save was in flight)
  const skipDetailsReloadRef = useRef(null);

  // Derived dirty state
  const isDirty = Boolean(selectedFile && editorSource !== savedSource);

  // Diff against the last saved source. Deferred so typing stays responsive on large files.
  const deferredSource = useDeferredValue(editorSource);
  const diff = useMemo(
    () => (deferredSource !== savedSource ? diffLines(savedSource, deferredSource) : null),
    [savedSource, deferredSource]
  );
  const activeDiff = isDirty ? diff : null;
  const markers = useMemo(() => (activeDiff ? lineMarkers(activeDiff.hunks) : null), [activeDiff]);
  // The Changes view only makes sense while there are unsaved edits
  const effectiveView = viewMode === 'changes' && !isDirty ? 'editor' : viewMode;

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
      const targetFile = files.find(f => f.id === fileNavTarget.fileId)
        || (fileNavTarget.relativePath && files.find(f => f.relative_path === fileNavTarget.relativePath));
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

    // The id changed only because the project was re-indexed after our own save:
    // the DB copy equals what we just saved, so keep the current buffer and banner.
    if (skipDetailsReloadRef.current === selectedFile.id) {
      skipDetailsReloadRef.current = null;
      return;
    }

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
          setViewMode('editor');
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

  // File selection with unsaved changes guard; range optionally highlights lines in the new file
  const handleSelectFile = (file, range = null) => {
    if (selectedFile && file.id === selectedFile.id) return;
    // Switching mid-save or mid-restore would let the response apply to the wrong file
    if (isSaving || isRestoring) return;

    if (isDirty) {
      setPendingFileSwitch(file);
      setPendingHighlight(range);
      setShowDiscardModal(true);
    } else {
      setSelectedFile(file);
      setHighlightRange(range);
      setSaveBanner(null);
    }
  };

  // Open a file/line from the Impact view, honouring the unsaved-changes guard
  const handleOpenLocation = (relativePath, line) => {
    const target = files.find(f => f.relative_path === relativePath);
    if (!target) return;
    const range = line ? { start: line, end: line } : null;
    if (selectedFile && target.id === selectedFile.id) {
      setViewMode('editor');
      setHighlightRange(range);
      return;
    }
    handleSelectFile(target, range);
  };

  // Discard confirmation (file switch, or Discard All when no switch is pending)
  const handleConfirmDiscard = () => {
    setEditorSource(savedSource);
    setShowDiscardModal(false);
    setSaveBanner(null);
    setViewMode('editor');
    if (pendingFileSwitch) {
      setSelectedFile(pendingFileSwitch);
      setPendingFileSwitch(null);
      setHighlightRange(pendingHighlight);
      setPendingHighlight(null);
      setSaveBanner(null);
    }
  };

  const handleCancelDiscard = () => {
    setShowDiscardModal(false);
    setPendingFileSwitch(null);
    setPendingHighlight(null);
  };

  // Discard All button: confirm before reverting the whole buffer to the last saved source
  const handleManualDiscard = () => {
    if (!isDirty) return;
    setPendingFileSwitch(null);
    setShowDiscardModal(true);
  };

  // Revert a single hunk in the editor buffer (nothing is written to disk until Save)
  const handleRevertHunk = (hunk) => {
    const next = revertHunk(editorSource, hunk);
    if (next !== null) {
      setEditorSource(next);
    }
  };

  // Jump from the Changes view to the hunk in the editor
  const handleJumpToHunk = (hunk) => {
    const start = hunk.newLines.length ? hunk.newStart : Math.max(1, hunk.newStart - 1);
    const end = hunk.newLines.length ? hunk.newStart + hunk.newLines.length - 1 : start;
    setViewMode('editor');
    setHighlightRange({ start, end });
  };

  // After a write that re-indexed the project: refresh the file list, follow the file's
  // new id without reloading the buffer we already hold, and refresh overview counts
  const refreshAfterReindex = async (newFileId) => {
    const freshFiles = await fetchFiles();
    if (newFileId) {
      if (newFileId !== selectedFile.id) {
        skipDetailsReloadRef.current = newFileId;
      }
      const freshSelected = freshFiles.find(f => f.id === newFileId);
      if (freshSelected) {
        setSelectedFile(freshSelected);
      } else {
        setSelectedFile(prev => ({ ...prev, id: newFileId }));
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
  };

  // Restore a saved version. HistoryView only offers this when the editor has no unsaved
  // edits; the guard is repeated here so edits can never be discarded silently.
  const handleRestoreVersion = async (version) => {
    if (!selectedFile || isDirty || isSaving || isRestoring) return;

    setIsRestoring(true);
    setSaveBanner(null);

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/projects/${overview.id}/files/versions/${encodeURIComponent(version.version_id)}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relative_path: selectedFile.relative_path }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (response.status === 200) {
        // Take the new baseline from the fresh index so it matches what the backend holds
        let restoredSource = version.source;
        if (data.new_file_id) {
          try {
            const fileRes = await fetch(`http://127.0.0.1:8000/files/${data.new_file_id}`);
            if (fileRes.ok) {
              restoredSource = (await fileRes.json()).source || '';
            }
          } catch (fileErr) {
            console.error("Failed to reload restored file:", fileErr);
          }
        }
        setEditorSource(restoredSource);
        setSavedSource(restoredSource);
        setSaveBanner({
          type: 'success',
          message: data.message || 'Version restored and project re-indexed successfully.',
          detail: 'The previous content was kept in History, so this restore can be undone.',
        });
        setViewMode('editor');
        await refreshAfterReindex(data.new_file_id);

      } else if (response.status === 207) {
        // Restored on disk, but the index is stale: the restored content is the new baseline
        setEditorSource(version.source);
        setSavedSource(version.source);
        setSaveBanner({
          type: 'warning',
          message: data.message || 'Version restored to disk, but re-indexing failed.',
          detail: data.detail || (data.status === 'reindex_missing_file' ? 'File record could not be confirmed in the index.' : 'AST/graphs may be stale until re-indexed.'),
        });
        setViewMode('editor');

      } else {
        setSaveBanner({
          type: 'error',
          message: data.detail || `Restore failed (HTTP ${response.status})`,
        });
      }
    } catch (err) {
      setSaveBanner({
        type: 'error',
        message: `Network error: ${err.message || 'Could not connect to backend'}. The file was not restored.`,
      });
    } finally {
      // A backup snapshot may exist even when the restore itself failed
      setHistoryRefreshKey(k => k + 1);
      setIsRestoring(false);
    }
  };

  // Save handler
  const handleSave = async () => {
    if (!selectedFile || isSaving || isRestoring) return;

    setIsSaving(true);
    setSaveBanner(null);

    // The exact content sent becomes the new baseline; edits typed during the save stay as a diff
    const sourceToSave = editorSource;

    try {
      const response = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relative_path: selectedFile.relative_path,
          source: sourceToSave,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 200) {
        // Full Success: persisted on disk and project re-indexed
        setSavedSource(sourceToSave);
        setSaveBanner({
          type: 'success',
          message: data.message || 'File saved and project re-indexed successfully.',
        });

        setHistoryRefreshKey(k => k + 1);
        await refreshAfterReindex(data.new_file_id);

      } else if (response.status === 207) {
        // HTTP 207 Multi-Status Partial Success: File written to disk, but re-indexing or lookup failed
        setSavedSource(sourceToSave); // The file was written to disk! Baseline is updated.
        setHistoryRefreshKey(k => k + 1);
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

  const VIEW_MODES = [
    { mode: 'editor', label: 'Editor', icon: 'code', tooltip: 'Edit source' },
    { mode: 'changes', label: 'Changes', icon: 'diff', tooltip: 'Compare unsaved changes with the last save' },
    { mode: 'history', label: 'History', icon: 'history', tooltip: 'Saved versions of this file' },
    { mode: 'impact', label: 'Impact', icon: 'impact', tooltip: 'Imports and cross-file calls' },
  ];

  const pathParts = selectedFile ? selectedFile.relative_path.split('/') : [];
  const fileName = pathParts[pathParts.length - 1];
  const syntaxError = validationResult && !validationResult.valid ? validationResult.errors?.[0] : null;

  return (
    <div className="explorer">
      {/* Column 2: File Tree */}
      <aside className="explorer-sidebar" aria-label="Project files">
        <div className="explorer-sidebar-header">
          <div className="explorer-sidebar-title">
            <h2 className="section-title"><Icon name="files" size={13} /> Explorer</h2>
            {!loading && !error && <span className="badge">{files.length} files</span>}
          </div>
        </div>
        <div className="explorer-sidebar-body">
          {loading ? (
            <LoadingState>Loading files...</LoadingState>
          ) : error ? (
            <Banner type="error" boxed>{error}</Banner>
          ) : files.length === 0 ? (
            <div className="empty-inline" style={{ padding: '12px' }}>No Python files were indexed in this project.</div>
          ) : (
            <TreeNode
              node={treeRoot}
              onSelect={handleSelectFile}
              selectedId={selectedFile?.id}
            />
          )}
        </div>
      </aside>

      {/* Column 3: Editor & Controls */}
      <section className="explorer-main" aria-label="Editor">
        {!selectedFile ? (
          <EmptyState icon="code" title="No file open">
            Choose a Python file in the explorer to view and edit it. You can compare unsaved changes,
            browse saved versions and see which files depend on it. Press <span className="kbd">Ctrl</span> <span className="kbd">S</span> to save.
          </EmptyState>
        ) : (
          <>
            {/* 1. Header Toolbar */}
            <div className="editor-toolbar">
              {/* Left: File Metadata & Status */}
              <div className="editor-toolbar-left">
                <div className="file-breadcrumb" title={selectedFile.relative_path}>
                  <Icon name="file" size={14} style={{ color: 'var(--cs-cyan)', flexShrink: 0 }} />
                  {pathParts.slice(0, -1).map((part, i) => (
                    <React.Fragment key={i}>
                      <span className="truncate">{part}</span>
                      <Icon name="chevronRight" size={11} className="subtle" />
                    </React.Fragment>
                  ))}
                  <span className="current truncate">{fileName}</span>
                </div>

                <span className="toolbar-divider" />

                {/* Dirty Status */}
                {isDirty ? (
                  <span className="status-text warning"><span className="dot dot-warning" /> Unsaved</span>
                ) : (
                  <span className="status-text success"><Icon name="check" size={12} /> Saved</span>
                )}

                {/* Unsaved change stats vs. last saved source */}
                {activeDiff && (
                  <span
                    className="diff-stats"
                    title={`${activeDiff.stats.added} added, ${activeDiff.stats.removed} removed, ${activeDiff.stats.modified} modified lines since last save`}
                  >
                    <span className="add">+{activeDiff.stats.added}</span>
                    <span className="remove">−{activeDiff.stats.removed}</span>
                    <span className="modify">~{activeDiff.stats.modified}</span>
                  </span>
                )}

                {/* Syntax Validation */}
                {isValidating ? (
                  <span className="status-text"><span className="spinner" style={{ width: '11px', height: '11px' }} /> Checking syntax</span>
                ) : validationResult ? (
                  validationResult.valid ? (
                    <span className="status-text success" title="Python syntax is valid"><Icon name="checkCircle" size={12} /> Syntax OK</span>
                  ) : (
                    <span className="status-text danger"><Icon name="alertCircle" size={12} /> Syntax error · line {syntaxError?.line || '?'}</span>
                  )
                ) : null}

                <span className="status-text subtle">{editorSource.split('\n').length} lines</span>
              </div>

              {/* Right: View toggle and actions */}
              <div className="editor-toolbar-right">
                <div className="segmented" role="group" aria-label="Editor view">
                  {VIEW_MODES.map(({ mode, label, icon, tooltip }) => {
                    const isActive = effectiveView === mode;
                    const isDisabled = mode === 'changes' && !isDirty;
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={isActive}
                        disabled={isDisabled}
                        onClick={() => setViewMode(mode)}
                        title={isDisabled ? 'No unsaved changes to compare' : tooltip}
                      >
                        <Icon name={icon} size={13} />
                        {label}
                        {mode === 'changes' && activeDiff && <span className="seg-count">{activeDiff.hunks.length}</span>}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleManualDiscard}
                  title="Revert all unsaved changes to the last saved version"
                  disabled={!isDirty || isSaving}
                >
                  <Icon name="undo" size={13} /> Discard All…
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isRestoring}
                  className="btn-primary btn-sm"
                  title="Save and re-index (Ctrl+S)"
                  style={{ cursor: isSaving ? 'wait' : undefined }}
                >
                  {isSaving ? <span className="spinner" style={{ width: '11px', height: '11px', borderTopColor: '#fff' }} /> : <Icon name="save" size={13} />}
                  {isSaving ? 'Saving...' : 'Save'}
                  {!isSaving && <span className="kbd">Ctrl S</span>}
                </button>
              </div>
            </div>

            {/* 2. Feedback Banners */}
            {saveBanner && (
              <Banner
                type={saveBanner.type}
                title={saveBanner.type === 'success' ? 'Done.' : saveBanner.type === 'warning' ? 'Warning:' : 'Error:'}
                detail={saveBanner.detail}
                onDismiss={() => setSaveBanner(null)}
              >
                {saveBanner.message}
              </Banner>
            )}

            {/* Syntax Validation Error Detail Banner */}
            {syntaxError && (
              <Banner
                type="error"
                title={`Syntax error on line ${syntaxError.line}:`}
                detail={syntaxError.text ? <code>{syntaxError.text}</code> : undefined}
              >
                {syntaxError.message}
              </Banner>
            )}

            {/* 3. Code Editor */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
              {loadingDetails ? (
                <LoadingState>Loading source code...</LoadingState>
              ) : (
                <>
                  {/* Kept mounted while hidden so scroll position and native undo survive view switches */}
                  <div style={{ display: effectiveView === 'editor' ? 'flex' : 'none', height: '100%' }}>
                    <CodeEditor
                      value={editorSource}
                      onChange={setEditorSource}
                      onSave={handleSave}
                      highlightRange={highlightRange}
                      lineMarkers={markers}
                    />
                  </div>
                  {effectiveView === 'changes' && (
                    <DiffView
                      hunks={activeDiff?.hunks}
                      truncated={activeDiff?.truncated}
                      currentSource={deferredSource}
                      onRevertHunk={handleRevertHunk}
                      onJumpToHunk={handleJumpToHunk}
                    />
                  )}
                  {effectiveView === 'history' && (
                    <HistoryView
                      projectId={overview.id}
                      relativePath={selectedFile.relative_path}
                      savedSource={savedSource}
                      isDirty={isDirty}
                      isRestoring={isRestoring}
                      refreshKey={historyRefreshKey}
                      onRestore={handleRestoreVersion}
                    />
                  )}
                  {effectiveView === 'impact' && (
                    <FileImpactView
                      key={`${selectedFile.relative_path}:${historyRefreshKey}`}
                      projectId={overview.id}
                      relativePath={selectedFile.relative_path}
                      onOpenLocation={handleOpenLocation}
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>

      {/* Discard Confirmation Modal (file switch, or Discard All) */}
      <ConfirmDialog
        open={showDiscardModal}
        title={pendingFileSwitch ? 'Discard unsaved changes?' : 'Discard all changes?'}
        tone="danger"
        confirmLabel={pendingFileSwitch ? 'Discard & open file' : 'Discard all'}
        cancelLabel="Keep editing"
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancelDiscard}
      >
        {pendingFileSwitch ? (
          <>
            <strong>{selectedFile?.relative_path}</strong> has unsaved changes. Discard them and
            open <strong>{pendingFileSwitch.relative_path}</strong>?
          </>
        ) : (
          <>
            Revert <strong>{selectedFile?.relative_path}</strong> to the last saved version?
            {activeDiff && (
              <>
                {' '}This discards {activeDiff.stats.added} added, {activeDiff.stats.removed} removed
                and {activeDiff.stats.modified} modified line{activeDiff.stats.modified === 1 ? '' : 's'}.
              </>
            )}
            {' '}Nothing on disk is changed.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

export default FileExplorer;

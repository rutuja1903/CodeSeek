import React, { useState, useEffect, useMemo } from 'react';
import CodeEditor from './CodeEditor';
import { diffLines } from '../utils/lineDiff';
import Icon from './ui/Icon';
import { Banner, ConfirmDialog, EmptyState, LoadingState } from './ui/ui';

/**
 * HistoryView -- Saved versions of the selected file, with read-only preview and restore.
 *
 * Versions are snapshots taken automatically before each save and each restore.
 * Restoring is delegated to onRestore (FileExplorer owns the editor state) and is
 * disabled while the editor has unsaved changes, so edits are never discarded silently.
 */

const REASON_LABELS = {
  save: 'Before save',
  restore: 'Before restore',
};

const API_BASE = 'http://127.0.0.1:8000';

function formatTimestamp(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function HistoryView({ projectId, relativePath, savedSource, isDirty, isRestoring, refreshKey, onRestore }) {
  const [versions, setVersions] = useState([]);
  const [maxVersions, setMaxVersions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Load the version list
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ relative_path: relativePath });
        const res = await fetch(`${API_BASE}/projects/${projectId}/files/versions?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Failed to load history (HTTP ${res.status})`);
        if (isMounted) {
          setVersions(data.versions || []);
          setMaxVersions(data.max_versions ?? null);
          setSelectedId((prev) => (data.versions || []).some((v) => v.version_id === prev) ? prev : data.versions?.[0]?.version_id ?? null);
        }
      } catch (err) {
        if (isMounted) setError(err.message || 'Could not connect to the backend.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [projectId, relativePath, refreshKey]);

  // Load the selected version's content
  useEffect(() => {
    if (!selectedId) return;
    let isMounted = true;
    const load = async () => {
      setLoadingPreview(true);
      setPreviewError(null);
      try {
        const params = new URLSearchParams({ relative_path: relativePath });
        const res = await fetch(`${API_BASE}/projects/${projectId}/files/versions/${encodeURIComponent(selectedId)}?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Failed to load version (HTTP ${res.status})`);
        if (isMounted) setPreview(data);
      } catch (err) {
        if (isMounted) {
          setPreview(null);
          setPreviewError(err.message || 'Could not connect to the backend.');
        }
      } finally {
        if (isMounted) setLoadingPreview(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [projectId, relativePath, selectedId]);

  // Only the loaded preview of the currently selected version is shown or restorable
  const activePreview = selectedId && preview?.version_id === selectedId ? preview : null;

  const handleConfirmRestore = async () => {
    setShowConfirm(false);
    if (activePreview) {
      await onRestore(activePreview);
    }
  };

  // What restoring this version would change relative to the current saved file
  const restoreDiff = useMemo(
    () => (activePreview ? diffLines(savedSource, activePreview.source) : null),
    [activePreview, savedSource]
  );
  const matchesCurrent = restoreDiff && restoreDiff.hunks.length === 0;
  const canRestore = activePreview && !isDirty && !isRestoring && !matchesCurrent;

  if (loading && versions.length === 0) {
    return <LoadingState>Loading history...</LoadingState>;
  }
  if (error) {
    return <div style={{ padding: '20px' }}><Banner type="error" boxed>{error}</Banner></div>;
  }
  if (versions.length === 0) {
    return (
      <EmptyState icon="history" title="No saved versions yet">
        A recoverable version of this file is kept automatically each time you save it or restore an
        earlier version. The latest {maxVersions || 10} versions are kept.
      </EmptyState>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Version list */}
      <div style={{ width: '270px', flexShrink: 0, borderRight: '1px solid var(--cs-border)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--cs-bg-2)' }}>
        <div className="panel-header" style={{ minHeight: '38px' }}>
          <h3 className="section-title"><Icon name="history" size={13} /> Versions <span className="count">{versions.length}</span></h3>
          {maxVersions && <span className="subtle" style={{ fontSize: 'var(--cs-text-2xs)' }}>latest {maxVersions} kept</span>}
        </div>
        <ul role="listbox" aria-label="Saved versions" style={{ listStyle: 'none', margin: 0, padding: '6px', overflowY: 'auto', flex: 1 }}>
          {versions.map((v, index) => {
            const isSelected = v.version_id === selectedId;
            return (
              <li key={v.version_id} style={{ marginBottom: '2px' }}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => setSelectedId(v.version_id)}
                  className={`list-item${isSelected ? ' is-selected' : ''}`}
                >
                  <span className="list-item-title">
                    <span className="truncate">{formatTimestamp(v.created_at)}</span>
                    {index === 0 && <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>Latest</span>}
                  </span>
                  <span className="list-item-meta">
                    <span className={`badge${v.reason === 'restore' ? ' badge-cyan' : ''}`}>{REASON_LABELS[v.reason] || v.reason}</span>
                    <span>{v.line_count} lines</span>
                    <span>·</span>
                    <span>{formatSize(v.size)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Preview */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="editor-toolbar" style={{ minHeight: '40px', background: 'var(--cs-bg-1)' }}>
          <div className="editor-toolbar-left">
            <span className="status-text" style={{ color: 'var(--cs-text)', fontWeight: 600 }}><Icon name="eye" size={13} /> Preview · read-only</span>
            {restoreDiff && (
              matchesCurrent ? (
                <span className="status-text success"><Icon name="check" size={12} /> Identical to the current saved file</span>
              ) : (
                <span className="diff-stats" title="Lines that change if this version is restored">
                  <span className="subtle" style={{ fontFamily: 'var(--cs-font-sans)' }}>vs. current</span>
                  <span className="add">+{restoreDiff.stats.added}</span>
                  <span className="remove">−{restoreDiff.stats.removed}</span>
                  <span className="modify">~{restoreDiff.stats.modified}</span>
                </span>
              )
            )}
            {activePreview && (activePreview.line_endings !== 'lf' || activePreview.has_bom) && (
              <span className="badge" title="Restoring writes the snapshot's exact original bytes">
                {activePreview.line_endings === 'crlf' ? 'CRLF' : activePreview.line_endings === 'mixed' ? 'Mixed line endings' : 'LF'}
                {activePreview.has_bom ? ' · UTF-8 BOM' : ''}
              </span>
            )}
          </div>
          <div className="editor-toolbar-right">
            {isDirty && (
              <span className="status-text warning"><Icon name="alert" size={12} /> Save or discard unsaved changes to restore</span>
            )}
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => setShowConfirm(true)}
              disabled={!canRestore}
              title={matchesCurrent ? 'This version matches the current file' : 'Restore this version (the current file is kept in history)'}
            >
              {isRestoring ? <span className="spinner" style={{ width: '11px', height: '11px', borderTopColor: '#fff' }} /> : <Icon name="restore" size={13} />}
              {isRestoring ? 'Restoring...' : 'Restore this version'}
            </button>
          </div>
        </div>

        {activePreview?.decode_errors && (
          <Banner type="warning">
            This version contains bytes that are not valid UTF-8. The preview shows them as �, but restoring writes the original bytes unchanged.
          </Banner>
        )}

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {loadingPreview ? (
            <LoadingState>Loading version...</LoadingState>
          ) : previewError ? (
            <div style={{ padding: '20px' }}><Banner type="error" boxed>{previewError}</Banner></div>
          ) : activePreview ? (
            <CodeEditor value={activePreview.source} onChange={() => {}} readOnly placeholder="(empty file)" />
          ) : null}
        </div>
      </div>

      {/* Restore confirmation */}
      <ConfirmDialog
        open={showConfirm && Boolean(activePreview)}
        title="Restore this version?"
        icon="restore"
        confirmLabel="Restore version"
        onConfirm={handleConfirmRestore}
        onCancel={() => setShowConfirm(false)}
      >
        Replace <strong>{relativePath}</strong> on disk with the version from{' '}
        <strong>{activePreview ? formatTimestamp(activePreview.created_at) : ''}</strong> and re-index the project?
        The current file is kept in history first, so you can undo this.
      </ConfirmDialog>
    </div>
  );
}

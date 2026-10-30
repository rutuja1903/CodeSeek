import React, { useState, useRef } from 'react';
import Icon, { BrandMark } from './ui/Icon';
import { ConfirmDialog } from './ui/ui';
import { formatRelativeTime, pluralize } from '../utils/format';
import '../index.css';

// Navigation structure; ids match App.jsx tabs
const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { id: 'search', label: 'Search', icon: 'search' },
      { id: 'files', label: 'File Explorer', icon: 'files' },
    ],
  },
  {
    label: 'Code Intelligence',
    items: [
      { id: 'functions', label: 'Functions', icon: 'function' },
      { id: 'classes', label: 'Classes', icon: 'class' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { id: 'graphs', label: 'Dependency Graphs', icon: 'graph' },
      { id: 'statistics', label: 'Statistics', icon: 'stats' },
    ],
  },
];

const PAGE_TITLES = Object.fromEntries(NAV_SECTIONS.flatMap(s => s.items.map(i => [i.id, i.label])));

function AppShell({ overview, activeTab, onNavigate, onUpdateOverview, isEditorDirty, children }) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const fileInputRef = useRef(null);

  const handleUpdateClick = () => {
    if (isEditorDirty) {
      setShowUpdateConfirm(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleConfirmUpdate = () => {
    setShowUpdateConfirm(false);
    fileInputRef.current?.click();
  };

  const handleUpdate = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError("Please select a .zip file.");
      e.target.value = '';
      return;
    }

    setUpdating(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/update-upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || "Update failed");
      }

      const data = await response.json();
      const overviewRes = await fetch(`http://127.0.0.1:8000/projects/${data.project_id}`);
      if (!overviewRes.ok) throw new Error("Could not fetch updated project overview");

      const updatedOverview = await overviewRes.json();
      onUpdateOverview(updatedOverview);

      // Clear file input
      e.target.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <BrandMark />
          <span className="brand-name">CodeSeek</span>
        </div>

        <div className="sidebar-project" title={overview.root_path}>
          <div className="sidebar-project-name">
            <span className="dot dot-success" aria-hidden="true" />
            <span className="truncate">{overview.name}</span>
          </div>
          <div className="sidebar-project-meta">
            {pluralize(overview.counts?.files ?? 0, 'file')} · indexed {formatRelativeTime(overview.indexed_at)}
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map(section => (
            <React.Fragment key={section.label}>
              <div className="nav-section">{section.label}</div>
              {section.items.map(item => {
                const isActive = activeTab === item.id;
                const showDirty = item.id === 'files' && isEditorDirty;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-item${isActive ? ' active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={showDirty ? `${item.label} (unsaved changes)` : item.label}
                    data-tooltip={item.label}
                    data-tooltip-pos="right"
                  >
                    <Icon name={item.icon} size={16} />
                    <span className="nav-label">{item.label}</span>
                    {showDirty && <span className="nav-indicator" aria-hidden="true" />}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </nav>

        {/* Update Project Action */}
        <div className="sidebar-footer">
          {error && <div className="sidebar-error" role="alert">{error}</div>}
          <input
            type="file"
            ref={fileInputRef}
            accept=".zip"
            style={{ display: 'none' }}
            onChange={handleUpdate}
            disabled={updating}
          />
          <button
            type="button"
            className="btn btn-block"
            disabled={updating}
            onClick={handleUpdateClick}
            aria-label="Update project from a new ZIP"
            data-tooltip="Update project (ZIP)"
            data-tooltip-pos="right"
          >
            {updating ? <span className="spinner" /> : <Icon name="upload" size={14} />}
            <span className="btn-label">{updating ? 'Updating...' : 'Update Project'}</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="truncate">{overview.name}</span>
            <Icon name="chevronRight" size={12} className="breadcrumb-sep" />
            <span className="breadcrumb-current">{PAGE_TITLES[activeTab] || ''}</span>
          </div>
          <div className="topbar-actions">
            {isEditorDirty && (
              <span className="badge badge-warning" title="The open file has unsaved changes">
                <span className="dot dot-warning" aria-hidden="true" /> Unsaved changes
              </span>
            )}
            <span className="badge" title={`Indexed at ${overview.indexed_at} (UTC)`}>
              <Icon name="refresh" size={11} /> Indexed {formatRelativeTime(overview.indexed_at)}
            </span>
          </div>
        </header>
        <div className="app-content">
          {children}
        </div>
      </main>

      <ConfirmDialog
        open={showUpdateConfirm}
        title="Update project with unsaved edits?"
        tone="danger"
        confirmLabel="Discard edits & choose ZIP"
        cancelLabel="Keep editing"
        onConfirm={handleConfirmUpdate}
        onCancel={() => setShowUpdateConfirm(false)}
      >
        The editor has unsaved changes. Updating the project from a new ZIP replaces the codebase and
        <strong> discards those unsaved edits</strong>.
      </ConfirmDialog>
    </div>
  );
}

export default AppShell;

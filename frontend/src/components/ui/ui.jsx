import React, { useEffect } from 'react';
import Icon from './Icon';

/**
 * ui.jsx -- Small shared UI primitives built on the classes in index.css.
 */

/**
 * ConfirmDialog -- Modal confirmation. Escape and the backdrop cancel; focus starts on
 * the cancel button so a stray Enter never confirms a destructive action.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  icon,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;
  const isDanger = tone === 'danger';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cs-dialog-title">
        <div className="modal-header">
          <div className={`modal-icon${isDanger ? ' danger' : ''}`}>
            <Icon name={icon || (isDanger ? 'alert' : 'info')} size={16} />
          </div>
          <h2 id="cs-dialog-title" className="modal-title">{title}</h2>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button type="button" className="btn" autoFocus onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={isDanger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

const BANNER_ICONS = {
  success: 'checkCircle',
  warning: 'alert',
  error: 'alertCircle',
  info: 'info',
};

/**
 * Banner -- Inline status message (success / warning / error / info) with optional dismiss.
 */
export function Banner({ type = 'info', title, children, detail, onDismiss, boxed = false }) {
  return (
    <div className={`banner banner-${type}${boxed ? ' banner-boxed' : ''}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICONS[type]} size={15} />
      <div className="banner-body">
        {title && <strong>{title} </strong>}
        {children}
        {detail && <div className="banner-detail">{detail}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss message" data-tooltip="Dismiss">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * EmptyState -- Centered explanation for empty views, with optional actions.
 */
export function EmptyState({ icon = 'info', title, children, actions }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Icon name={icon} size={20} /></div>
      {title && <div className="empty-state-title">{title}</div>}
      {children && <div className="empty-state-text">{children}</div>}
      {actions && <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>{actions}</div>}
    </div>
  );
}

export function LoadingState({ children = 'Loading...' }) {
  return (
    <div className="loading-row" role="status">
      <span className="spinner" />
      {children}
    </div>
  );
}

/**
 * PageHeader -- Title, description and right-aligned actions for scrolling pages.
 */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}

/**
 * Panel -- Bordered surface with an optional header row.
 */
export function Panel({ title, icon, count, actions, children, bodyStyle, style }) {
  return (
    <section className="panel" style={style}>
      {(title || actions) && (
        <div className="panel-header">
          <h2 className="section-title">
            {icon && <Icon name={icon} size={13} />}
            {title}
            {count !== undefined && count !== null && <span className="count">{count}</span>}
          </h2>
          {actions}
        </div>
      )}
      <div className="panel-body" style={bodyStyle}>{children}</div>
    </section>
  );
}

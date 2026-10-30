import React from 'react';
import { API_BASE, useAnalysis } from './analysisHooks';
import Icon from './ui/Icon';
import { Banner, LoadingState } from './ui/ui';

/**
 * CodeInsights -- Static code-intelligence views shared by the explorers:
 *   SymbolInsights   References / Call Hierarchy / Impact for a function or class
 *   FileImpactView   Direct import and call relationships of a file
 *   UnusedFilter     "Potentially unused" toggle and caveat for explorer lists
 *
 * Every result row is clickable and opens the exact file and line. All data comes
 * from the backend /analysis endpoints, which never execute project code.
 */

const CONFIDENCE = {
  resolved: { label: 'Resolved', badge: 'badge-success', title: 'The name matches exactly one definition in this project' },
  ambiguous: { label: 'Ambiguous', badge: 'badge-warning', title: 'Several project definitions share this name; this may refer to a different one' },
  name_match: { label: 'Name match', badge: 'badge-warning', title: 'The imported name matches, but the module could not be resolved statically' },
  unresolved: { label: 'External', badge: '', title: 'No definition in this project: a builtin, a library, or a dynamic call' },
};

const KIND_LABELS = {
  call: 'Call',
  instantiation: 'Instantiation',
  import: 'Import',
  subclass: 'Subclass',
};

const RELATION_LABELS = {
  calls: 'Calls',
  method: 'Method',
  subclass: 'Subclass',
  base_class: 'Base class',
  parent_class: 'Defined in class',
  enclosing_function: 'Defined in function',
  method_caller: 'Calls a method of this class',
};

const TAB_ICONS = {
  overview: 'eye',
  references: 'references',
  calls: 'callHierarchy',
  impact: 'impact',
};

const listStyle = { display: 'flex', flexDirection: 'column', gap: '6px' };

function shortName(symbol) {
  // "pkg/models.py::User.save" -> "User.save"
  return symbol.symbol_id ? symbol.symbol_id.split('::').pop() : symbol.name;
}

export function ConfidenceBadge({ confidence }) {
  const info = CONFIDENCE[confidence];
  if (!info) return null;
  return <span className={`badge ${info.badge}`} title={info.title}>{info.label}</span>;
}

function KindBadge({ kind }) {
  return <span className="badge badge-accent">{KIND_LABELS[kind] || kind}</span>;
}

export function StaticNotice({ text }) {
  return (
    <div className="note">
      <Icon name="info" size={14} />
      <span>{text}</span>
    </div>
  );
}

function StatusMessage({ loading, error, children }) {
  if (loading) return <LoadingState>Analyzing...</LoadingState>;
  if (error) return <Banner type="error" boxed>{error}</Banner>;
  return children;
}

function Empty({ children }) {
  return <div className="empty-inline">{children}</div>;
}

function SectionTitle({ icon, children, count }) {
  return (
    <h3 className="section-title" style={{ marginBottom: '8px' }}>
      {icon && <Icon name={icon} size={13} />}
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </h3>
  );
}

function StatStrip({ items }) {
  return (
    <div className="stat-strip">
      {items.map(([label, value]) => (
        <div className="stat" key={label} style={{ padding: '10px 14px' }}>
          <span className="stat-label">{label}</span>
          <span className="stat-value" style={{ fontSize: 'var(--cs-text-lg)' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One clickable source location: title line, path:line, optional snippet and badges.
 * A div with role="button" because titles can contain their own symbol links.
 */
function LocationRow({ title, relativePath, line, snippet, badges, onOpen }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="result-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`Open ${relativePath}${line ? `:${line}` : ''}`}
    >
      <div className="result-row-head">
        <div className="truncate" style={{ fontSize: 'var(--cs-text-sm)' }}>{title}</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>{badges}</div>
      </div>
      <div className="result-row-location">
        {relativePath}{line ? `:${line}` : ''}
      </div>
      {snippet && <code className="result-row-snippet">{snippet}</code>}
    </div>
  );
}

function contextLabel(context) {
  if (!context) return 'Module level';
  if (context.stale) return `${context.name} (no longer in the index)`;
  return `in ${shortName(context)}`;
}

// ---------------------------------------------------------------------------
// SymbolInsights
// ---------------------------------------------------------------------------

const VIEW_ENDPOINTS = {
  references: 'references',
  calls: 'call-hierarchy',
  impact: 'impact',
};

/**
 * Props:
 *   projectId, symbolId          -- deterministic symbol id (stable across re-indexing)
 *   view                         -- 'references' | 'calls' | 'impact'
 *   onOpenLocation(fileId, startLine, endLine, relativePath)
 *   onSelectSymbol(symbolSummary) -- select a related symbol in the explorer
 */
export function SymbolInsights({ projectId, symbolId, view, onOpenLocation, onSelectSymbol }) {
  const params = new URLSearchParams({ symbol_id: symbolId });
  const url = `${API_BASE}/projects/${projectId}/analysis/${VIEW_ENDPOINTS[view]}?${params}`;
  const { data, loading, error } = useAnalysis(url);

  const openRef = (item) => onOpenLocation(item.file_id, item.line, item.line, item.relative_path);
  const openSymbol = (sym) => onOpenLocation(sym.file_id, sym.start_line, sym.end_line, sym.relative_path);

  return (
    <div className="detail-body">
      <StatusMessage loading={loading} error={error}>
        {data && view === 'references' && <ReferencesPanel data={data} openRef={openRef} />}
        {data && view === 'calls' && <CallHierarchyPanel data={data} openRef={openRef} openSymbol={openSymbol} onSelectSymbol={onSelectSymbol} />}
        {data && view === 'impact' && <ImpactPanel data={data} openRef={openRef} openSymbol={openSymbol} onSelectSymbol={onSelectSymbol} />}
        {data && <StaticNotice text={data.notice} />}
      </StatusMessage>
    </div>
  );
}

function ReferencesPanel({ data, openRef }) {
  const refs = data.references;
  if (refs.length === 0) {
    return <Empty>No references to {data.symbol.name} were found in this project.</Empty>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: 'var(--cs-text-sm)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span><strong>{refs.length}</strong> reference{refs.length === 1 ? '' : 's'} in <strong>{data.files.length}</strong> file{data.files.length === 1 ? '' : 's'}</span>
        {Object.entries(data.counts).map(([kind, count]) => (
          <span key={kind} className="badge">{KIND_LABELS[kind] || kind} · {count}</span>
        ))}
      </div>
      {data.files.map((file) => (
        <div key={file.relative_path}>
          <SectionTitle icon="file" count={file.reference_count}><span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{file.relative_path}</span></SectionTitle>
          <div style={listStyle}>
            {refs.filter((r) => r.relative_path === file.relative_path).map((ref, i) => (
              <LocationRow
                key={`${ref.kind}-${ref.line}-${i}`}
                title={contextLabel(ref.context)}
                relativePath={ref.relative_path}
                line={ref.line}
                snippet={ref.snippet || ref.text}
                badges={<><KindBadge kind={ref.kind} /><ConfidenceBadge confidence={ref.confidence} /></>}
                onOpen={() => openRef(ref)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SymbolLink({ symbol, onSelectSymbol }) {
  return (
    <button
      type="button"
      className="link-btn mono"
      onClick={(e) => {
        e.stopPropagation();
        onSelectSymbol(symbol);
      }}
      title={`Show ${shortName(symbol)} (${symbol.relative_path}:${symbol.start_line})`}
    >
      {shortName(symbol)}
    </button>
  );
}

function CallHierarchyPanel({ data, openRef, onSelectSymbol }) {
  const name = shortName(data.symbol);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div>
        <SectionTitle icon="arrowDownLeft" count={data.incoming.length}>Incoming calls · what calls {name}</SectionTitle>
        <div style={listStyle}>
          {data.incoming.length === 0 && <Empty>No callers found in this project.</Empty>}
          {data.incoming.map((call, i) => (
            <LocationRow
              key={`in-${call.relative_path}-${call.line}-${i}`}
              title={call.context && !call.context.stale ? <>Called from <SymbolLink symbol={call.context} onSelectSymbol={onSelectSymbol} /></> : contextLabel(call.context)}
              relativePath={call.relative_path}
              line={call.line}
              snippet={call.snippet || call.text}
              badges={<ConfidenceBadge confidence={call.confidence} />}
              onOpen={() => openRef(call)}
            />
          ))}
        </div>
      </div>

      <div>
        <SectionTitle icon="arrowUpRight" count={data.outgoing.length}>Outgoing calls · what {name} calls</SectionTitle>
        <div style={listStyle}>
          {data.outgoing.length === 0 && <Empty>{name} makes no calls.</Empty>}
          {data.outgoing.map((call, i) => (
            <LocationRow
              key={`out-${call.line}-${i}`}
              title={
                call.target ? (
                  <>Calls <SymbolLink symbol={call.target} onSelectSymbol={onSelectSymbol} /> <span className="subtle">({call.target.relative_path})</span></>
                ) : call.candidates.length > 0 ? (
                  <>
                    {call.callee}() may call{' '}
                    {call.candidates.map((c, j) => (
                      <React.Fragment key={c.symbol_id}>
                        {j > 0 && ', '}
                        <SymbolLink symbol={c} onSelectSymbol={onSelectSymbol} />
                      </React.Fragment>
                    ))}
                    {call.candidate_count > call.candidates.length && ` and ${call.candidate_count - call.candidates.length} more`}
                  </>
                ) : (
                  <><span className="mono">{call.callee}()</span> <span className="subtle">· not defined in this project</span></>
                )
              }
              relativePath={call.relative_path}
              line={call.line}
              snippet={call.snippet || call.text}
              badges={<ConfidenceBadge confidence={call.confidence} />}
              onOpen={() => openRef(call)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SymbolRow({ symbol, label, openSymbol, onSelectSymbol }) {
  return (
    <LocationRow
      title={<>{label && <span className="muted">{label}: </span>}<SymbolLink symbol={symbol} onSelectSymbol={onSelectSymbol} /></>}
      relativePath={symbol.relative_path}
      line={symbol.start_line}
      badges={<span className="badge">{symbol.symbol_type.replace('_', ' ')}</span>}
      onOpen={() => openSymbol(symbol)}
    />
  );
}

function ImpactPanel({ data, openRef, openSymbol, onSelectSymbol }) {
  const firstRefIn = (path) => data.references.find((r) => r.relative_path === path);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <StatStrip items={[
        ['Direct references', data.references.length],
        ['Direct callers', data.callers.length],
        ['Files affected', data.files.length],
        ['Related symbols', data.related.length],
      ]} />

      <div>
        <SectionTitle icon="files" count={data.files.length}>Files with direct references</SectionTitle>
        <div style={listStyle}>
          {data.files.length === 0 && <Empty>No other code references this symbol.</Empty>}
          {data.files.map((file) => {
            const first = firstRefIn(file.relative_path);
            return (
              <LocationRow
                key={file.relative_path}
                title={Object.entries(file.kinds).map(([kind, n]) => `${n} ${(KIND_LABELS[kind] || kind).toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}
                relativePath={file.relative_path}
                line={first?.line}
                onOpen={() => openRef(first)}
              />
            );
          })}
        </div>
      </div>

      <div>
        <SectionTitle icon="arrowDownLeft" count={data.callers.length}>Direct callers</SectionTitle>
        <div style={listStyle}>
          {data.callers.length === 0 && <Empty>No calling functions found.</Empty>}
          {data.callers.map((caller) => (
            <SymbolRow key={caller.symbol_id} symbol={caller} openSymbol={openSymbol} onSelectSymbol={onSelectSymbol} />
          ))}
          {data.module_level_uses > 0 && (
            <Empty>Also used {data.module_level_uses} time{data.module_level_uses === 1 ? '' : 's'} from module-level code.</Empty>
          )}
        </div>
      </div>

      <div>
        <SectionTitle icon="layers" count={data.related.length}>Related functions and classes</SectionTitle>
        <div style={listStyle}>
          {data.related.length === 0 && <Empty>No directly related symbols found.</Empty>}
          {data.related.map((rel, i) => (
            <SymbolRow key={`${rel.relation}-${rel.symbol.symbol_id}-${i}`} symbol={rel.symbol} label={RELATION_LABELS[rel.relation] || rel.relation} openSymbol={openSymbol} onSelectSymbol={onSelectSymbol} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileImpactView
// ---------------------------------------------------------------------------

/**
 * Props: projectId, relativePath, onOpenLocation(relativePath, line)
 */
export function FileImpactView({ projectId, relativePath, onOpenLocation }) {
  const params = new URLSearchParams({ relative_path: relativePath });
  const { data, loading, error } = useAnalysis(`${API_BASE}/projects/${projectId}/analysis/file-impact?${params}`);

  const lineList = (lines) => {
    const unique = [...new Set(lines)];
    return `line${unique.length === 1 ? '' : 's'} ${unique.join(', ')}`;
  };

  return (
    <div className="detail-body" style={{ height: '100%', boxSizing: 'border-box' }}>
      <StatusMessage loading={loading} error={error}>
        {data && (
          <>
            <StatStrip items={[
              ['Imports from', data.imports_from.length],
              ['Imported by', data.imported_by.length],
              ['Called from other files', data.incoming_calls.length],
              ['Calls into other files', data.outgoing_calls.length],
            ]} />

            <div>
              <SectionTitle icon="arrowDownLeft" count={data.imported_by.length}>Imported by · files that may be affected</SectionTitle>
              <div style={listStyle}>
                {data.imported_by.length === 0 && <Empty>No project file imports this file.</Empty>}
                {data.imported_by.map((f) => (
                  <LocationRow key={f.relative_path} title={`Imports ${data.relative_path} at ${lineList(f.lines)}`} relativePath={f.relative_path} line={f.lines[0]} onOpen={() => onOpenLocation(f.relative_path, f.lines[0])} />
                ))}
              </div>
            </div>

            <div>
              <SectionTitle icon="arrowUpRight" count={data.imports_from.length}>Imports from · project dependencies</SectionTitle>
              <div style={listStyle}>
                {data.imports_from.length === 0 && <Empty>This file imports no other project files.</Empty>}
                {data.imports_from.map((f) => (
                  <LocationRow key={f.relative_path} title={`Imported here at ${lineList(f.lines)}`} relativePath={f.relative_path} onOpen={() => onOpenLocation(f.relative_path, null)} />
                ))}
                {data.external_imports.length > 0 && (
                  <div className="muted" style={{ fontSize: 'var(--cs-text-xs)' }}>
                    External or unresolved: <span className="mono">{data.external_imports.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>

            <CallGroups
              title="Functions here called from other files"
              icon="arrowDownLeft"
              empty="No functions in this file are called from other files."
              groups={data.incoming_calls}
              onOpenLocation={onOpenLocation}
            />
            <CallGroups
              title="Functions in other files called from here"
              icon="arrowUpRight"
              empty="This file calls no functions defined in other project files."
              groups={data.outgoing_calls}
              onOpenLocation={onOpenLocation}
            />

            <StaticNotice text={`${data.notice} Only calls that resolve to a single definition are listed here.`} />
          </>
        )}
      </StatusMessage>
    </div>
  );
}

function CallGroups({ title, icon, empty, groups, onOpenLocation }) {
  return (
    <div>
      <SectionTitle icon={icon} count={groups.length}>{title}</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {groups.length === 0 && <Empty>{empty}</Empty>}
        {groups.map((g) => (
          <div key={g.symbol.symbol_id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              type="button"
              className="link-btn mono"
              style={{ fontWeight: 600, fontSize: 'var(--cs-text-sm)' }}
              onClick={() => onOpenLocation(g.symbol.relative_path, g.symbol.start_line)}
              title={`Open definition (${g.symbol.relative_path}:${g.symbol.start_line})`}
            >
              {shortName(g.symbol)} <span className="subtle" style={{ fontWeight: 400 }}>({g.symbol.relative_path})</span>
            </button>
            {g.call_sites.map((site, i) => (
              <LocationRow
                key={`${site.relative_path}-${site.line}-${i}`}
                title={contextLabel(site.caller)}
                relativePath={site.relative_path}
                line={site.line}
                onOpen={() => onOpenLocation(site.relative_path, site.line)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Potentially unused
// ---------------------------------------------------------------------------

/**
 * Toggle button and caveat for an explorer list.
 */
export function UnusedFilter({ active, onToggle, unused, count }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className="btn btn-sm"
        title="Show only symbols with no visible use in this project"
        style={{
          justifyContent: 'flex-start',
          borderColor: active ? 'var(--cs-warning-border)' : undefined,
          background: active ? 'var(--cs-warning-soft)' : undefined,
          color: active ? 'var(--cs-warning)' : undefined,
        }}
      >
        <Icon name="unused" size={13} />
        Potentially unused
        {active && count !== null && <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
      </button>
      {active && unused.loading && <span className="status-text"><span className="spinner" style={{ width: '11px', height: '11px' }} /> Analyzing project...</span>}
      {active && unused.error && <Banner type="error" boxed>{unused.error}</Banner>}
      {active && unused.caveat && (
        <div className="note" style={{ fontSize: 'var(--cs-text-2xs)' }}>
          <Icon name="info" size={12} />
          <span>{unused.caveat}</span>
        </div>
      )}
    </div>
  );
}

export function UnusedBadge() {
  return (
    <span
      className="badge badge-warning"
      title="No visible use was found in this project. This is not a guarantee: see the note above the list."
    >
      Potentially unused
    </span>
  );
}

/**
 * Tab strip for explorer detail panes.
 */
export function DetailTabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
          >
            {TAB_ICONS[tab.id] && <Icon name={TAB_ICONS[tab.id]} size={14} />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

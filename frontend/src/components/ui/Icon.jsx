import React from 'react';

/**
 * Icon -- Inline SVG icon set (24px grid, 1.75 stroke), so CodeSeek needs no icon dependency.
 * Usage: <Icon name="save" size={14} />. Icons are decorative (aria-hidden); give the
 * surrounding control an accessible label.
 */

const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  files: <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="m10 13-2 2 2 2" /><path d="m14 17 2-2-2-2" /></>,
  file: <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /></>,
  folder: <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2.5H4a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1Z" />,
  folderOpen: <><path d="M3 19V5.5a1 1 0 0 1 1-1h5.5L12 7h7a1 1 0 0 1 1 1v2" /><path d="M3 19 5.6 11.7A1 1 0 0 1 6.5 11H21a1 1 0 0 1 .95 1.3L19.5 19.3a1 1 0 0 1-.95.7H4a1 1 0 0 1-1-1Z" /></>,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  function: <><path d="M9.5 20c1.5 0 2.2-1 2.5-3l1.5-10c.3-2 1-3 2.5-3" /><path d="M8 11h7" /></>,
  method: <><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" /><path d="M9 12h6" /></>,
  class: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></>,
  graph: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.5 6h7M7.3 8.2l3.5 7.5M16.7 8.2l-3.5 7.5" /></>,
  stats: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M21 20H3" /></>,
  upload: <><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M10 13h4" /></>,
  save: <><path d="M5 21h14a2 2 0 0 0 2-2V8l-5-5H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" /><path d="M7 21v-7h10v7" /><path d="M7 3v4h8" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
  diff: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M13 6h3a2 2 0 0 1 2 2v7.5" /><path d="M11 18H8a2 2 0 0 1-2-2V8.5" /><path d="m15 3-2 3 2 3" /><path d="m9 21 2-3-2-3" /></>,
  impact: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  code: <><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /></>,
  references: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></>,
  callHierarchy: <><rect x="9" y="3" width="6" height="4" rx="1" /><rect x="3" y="17" width="6" height="4" rx="1" /><rect x="15" y="17" width="6" height="4" rx="1" /><path d="M12 7v5M6 17v-2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" /></>,
  arrowDownLeft: <><path d="M17 7 7 17" /><path d="M17 17H7V7" /></>,
  arrowUpRight: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>,
  x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  alert: <><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  alertCircle: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  undo: <><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></>,
  refresh: <><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></>,
  cycle: <><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11V9a3 3 0 0 1 3-3h14" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 13v2a3 3 0 0 1-3 3h-14" /></>,
  unused: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  package: <><path d="m7.5 4.3 9 5.1" /><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3.3 7.6 8.7 5 8.7-5" /><path d="M12 22.5V12.6" /></>,
};

export default function Icon({ name, size = 16, strokeWidth = 1.75, className, style }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {path}
    </svg>
  );
}

/**
 * BrandMark -- CodeSeek logo: a lens over code brackets.
 */
export function BrandMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cs-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b9bff" />
          <stop offset="1" stopColor="#2dd4e8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#10141b" stroke="#2b3342" />
      <path d="m11.5 11-4 4.5 4 4.5" fill="none" stroke="url(#cs-brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18.5" cy="14.5" r="4.5" fill="none" stroke="url(#cs-brand)" strokeWidth="2.2" />
      <path d="m21.8 17.8 3.4 3.4" stroke="url(#cs-brand)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

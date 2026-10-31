/**
 * format.js -- Display formatting helpers.
 */

/**
 * Parse a SQLite CURRENT_TIMESTAMP value ("YYYY-MM-DD HH:MM:SS", UTC) or an ISO string.
 * Returns a Date, or null when the value cannot be parsed.
 */
export function parseTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "just now", "5 min ago", "3 h ago", "2 days ago", or a date for older values.
 */
export function formatRelativeTime(value, now = new Date()) {
  const date = value instanceof Date ? value : parseTimestamp(value);
  if (!date) return 'unknown';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

export function formatNumber(value) {
  return typeof value === 'number' ? value.toLocaleString() : (value ?? '—');
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Error text for a failed backend request. fetch() rejects with a TypeError
 * ("Failed to fetch") when the backend cannot be reached or a response is unreadable
 * (e.g. a server crash without CORS headers); explain that instead of showing it raw.
 */
export function describeRequestError(err, fallback = 'Request failed.') {
  if (err instanceof TypeError) {
    return 'Could not reach the CodeSeek backend at http://127.0.0.1:8000. Make sure it is running, then try again. If it is running, check its terminal for errors.';
  }
  return err?.message || fallback;
}

/**
 * Message from a FastAPI error body: `detail` is a string for HTTP errors and a list
 * of {msg} objects for request validation errors (422).
 */
export function errorDetail(body, fallback) {
  const detail = body?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) return detail.map((d) => d?.msg || String(d)).join('; ');
  return fallback;
}

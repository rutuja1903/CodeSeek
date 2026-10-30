import { useState, useEffect, useMemo } from 'react';

/**
 * analysisHooks.js -- Data hooks for the static code-intelligence views (CodeInsights.jsx).
 */

export const API_BASE = 'http://127.0.0.1:8000';

/**
 * Fetch JSON from an analysis endpoint whenever the URL changes (no request when url is null).
 * Returns { data, loading, error }; results for a previous URL are never returned for the current one.
 */
export function useAnalysis(url) {
  const [state, setState] = useState({ data: null, loading: true, error: null, url: null });

  useEffect(() => {
    if (!url) return;
    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || `Analysis failed (HTTP ${res.status})`);
        if (isMounted) setState({ data, loading: false, error: null, url });
      } catch (err) {
        if (isMounted) setState({ data: null, loading: false, error: err.message || 'Could not connect to the backend.', url });
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [url]);

  return state.url === url ? state : { data: null, loading: true, error: null };
}

/**
 * Loads the project's potentially unused symbols the first time `enabled` is true,
 * then keeps the result while the explorer stays open.
 * Returns { findings: Map<symbol_id, finding> | null, caveat, loading, error }.
 */
export function usePotentiallyUnused(projectId, enabled) {
  const [requested, setRequested] = useState(false);
  if (enabled && !requested) setRequested(true);
  const { data, loading, error } = useAnalysis(requested ? `${API_BASE}/projects/${projectId}/analysis/unused` : null);
  const findings = useMemo(() => (data ? new Map(data.findings.map((f) => [f.symbol.symbol_id, f])) : null), [data]);

  if (!requested) return { findings: null, caveat: null, loading: false, error: null };
  return { findings, caveat: data?.caveat, loading, error };
}

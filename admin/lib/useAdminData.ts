'use client';

/**
 * One hook for every admin page that shows live data.
 *
 * Three states, honestly reported: `unknown` while the first load is in
 * flight, `live` with the data, `offline` with a human sentence when the API
 * cannot be reached or errors. Pages render real rows or say why they cannot —
 * there is no sample-data fallback in the admin panel, because an operator
 * making a decision on an invented number is the one failure mode this screen
 * must not have.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, type LiveState } from './api';

export function useAdminData<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
): { state: LiveState<T>; reload: () => void; reloading: boolean } {
  const [state, setState] = useState<LiveState<T>>({ status: 'unknown' });
  const [reloading, setReloading] = useState(false);
  // The latest request wins; a stale response must not overwrite a newer one.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setReloading(true);
    try {
      const data = await fetcher();
      if (seq !== requestSeq.current) return;
      setState({ status: 'live', data });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setState({
        status: 'offline',
        message:
          err instanceof AdminApiError
            ? err.offline
              ? 'The API is not reachable from this browser.'
              : err.message
            : 'Request failed.',
      });
    } finally {
      if (seq === requestSeq.current) setReloading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: () => void load(), reloading };
}

/** Formatters shared by the live pages. */
export const fmtLive = {
  compact: (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n),
  date: (value: unknown): string => {
    if (!value) return '—';
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },
  dateTime: (value: unknown): string => {
    if (!value) return '—';
    const d = new Date(String(value));
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
};

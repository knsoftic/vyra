/**
 * One way to load remote data.
 *
 * Every wired screen needs the same four things: is the backend there, is the
 * request in flight, did it fail, and what should be shown while none of that is
 * settled. Writing that per screen produces four slightly different answers, and
 * the differences are always bugs.
 *
 * The fallback is the important argument. A screen that has sample data to show
 * should show it rather than an error, because the app has to remain usable
 * while the backend is still being built. `source` tells the screen which it
 * got, so it can label it honestly (ADR-028).
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import { useSession } from '../store/SessionState';

export type DataSource = 'live' | 'sample';

export interface ApiDataState<T> {
  data: T;
  source: DataSource;
  loading: boolean;
  /** Set only for real failures — never for "the backend is not running". */
  error: string | null;
  refresh: () => Promise<void>;
}

export interface ApiDataOptions {
  /** Skip the request until this is true. */
  enabled?: boolean;
  /** Require a signed-in session. Defaults to true. */
  requiresAuth?: boolean;
  /**
   * Whether an empty live result should fall back to the sample.
   *
   * True is right for discovery — an empty music library or category list is a
   * screen nobody can use, and sample content keeps it explorable while the
   * platform fills up.
   *
   * False is right for anything belonging to the caller. "You have no
   * verification applications" is a real, meaningful answer, and substituting a
   * sample one tells someone they have an *approved* application they never
   * made. Set false for my-tickets, my-applications, my-withdrawals and their
   * kind.
   */
  fallbackOnEmpty?: boolean;
}

export function useApiData<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  deps: readonly unknown[] = [],
  options: ApiDataOptions = {},
): ApiDataState<T> {
  const { backendStatus, isSignedIn } = useSession();
  const { enabled = true, requiresAuth = true, fallbackOnEmpty = true } = options;

  const [data, setData] = useState<T>(fallback);
  const [source, setSource] = useState<DataSource>('sample');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || backendStatus !== 'live' || (requiresAuth && !isSignedIn)) {
      setData(fallback);
      setSource('sample');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();

      // An empty live result is still live. For shared content a screen with
      // nothing on it is not useful, so the sample stands in and `source` keeps
      // reporting the truth. For the caller's own data an empty result is the
      // answer, and a stand-in would be a false statement about them.
      const isEmpty = fallbackOnEmpty && Array.isArray(result) && result.length === 0;
      if (isEmpty) {
        setData(fallback);
        setSource('sample');
      } else {
        setData(result);
        setSource('live');
      }
    } catch (err) {
      setData(fallback);
      setSource('sample');
      // Being offline is expected during development and is not worth an alarm.
      setError(err instanceof ApiError && !err.offline ? err.message : null);
    } finally {
      setLoading(false);
    }
    // `fetcher` and `fallback` are intentionally not dependencies: callers
    // define them inline, so including them would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, backendStatus, isSignedIn, requiresAuth, fallbackOnEmpty, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, source, loading, error, refresh: load };
}

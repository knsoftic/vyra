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
   * Whether an empty live result should fall back to the sample. Default false.
   *
   * It used to default to true, on the reasoning that an empty screen is not
   * useful. On a freshly launched platform that reasoning is a lie told at
   * scale: every list is legitimately empty, so every screen filled with
   * invented users, videos and follower counts. Signed-in people saw a busy
   * app that did not exist.
   *
   * Sample content has exactly one honest use — the backend cannot be reached,
   * which this hook already handles separately. When the server answers, its
   * answer is shown, including when the answer is nothing.
   *
   * Pass true only for a screen that is demonstrating the product with no data
   * behind it on purpose.
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
  const { enabled = true, requiresAuth = true, fallbackOnEmpty = false } = options;

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

      // An empty live result is still live, and by default it is shown as the
      // empty thing it is.
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

/**
 * Live search.
 *
 * Two things this has to get right that a plain `useApiData` would not.
 *
 * **Debouncing.** Search runs on every keystroke. Firing a request per character
 * would send a dozen requests for one word, all but the last of them already
 * obsolete, and would trip the server's rate limiter on a normal typing speed.
 * The term settles first, then one request goes out.
 *
 * **Ordering.** Responses can arrive out of order — a slow request for "ma" can
 * land after a fast one for "maya" and overwrite the better result with the
 * worse one. Each request records the term it was made for, and a response for
 * anything other than the current term is dropped.
 */

import { useEffect, useRef, useState } from 'react';
import { discover, music, type SearchResults, type MusicTrack } from '../api';
import { useSession } from '../store/SessionState';

const DEBOUNCE_MS = 300;
/** Below this a search matches most of the catalogue and is not worth sending. */
const MIN_LENGTH = 2;

export interface SearchState {
  results: SearchResults | null;
  sounds: MusicTrack[];
  loading: boolean;
  /** True when these results came from the server. */
  live: boolean;
}

export function useSearch(term: string): SearchState {
  const { backendStatus } = useSession();
  const [results, setResults] = useState<SearchResults | null>(null);
  const [sounds, setSounds] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);

  // What the newest request was made for; anything else is stale on arrival.
  const currentTerm = useRef('');

  useEffect(() => {
    const trimmed = term.trim();
    currentTerm.current = trimmed;

    if (backendStatus !== 'live' || trimmed.length < MIN_LENGTH) {
      setResults(null);
      setSounds([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // Sounds live in the music catalogue rather than the search index, so
          // they are a second call rather than a second index.
          const [found, tracks] = await Promise.all([
            discover.search(trimmed),
            music.list({ q: trimmed }).catch(() => [] as MusicTrack[]),
          ]);
          if (currentTerm.current !== trimmed) return;
          setResults(found);
          setSounds(tracks);
        } catch {
          if (currentTerm.current !== trimmed) return;
          // Falling back to the sample results is better than an error page.
          setResults(null);
          setSounds([]);
        } finally {
          if (currentTerm.current === trimmed) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, backendStatus]);

  return { results, sounds, loading, live: results !== null };
}

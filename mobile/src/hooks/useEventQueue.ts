/**
 * Behaviour event emission.
 *
 * The client half of Phase 6. Events are queued in memory and flushed in
 * batches, because one HTTP request per scroll would flatten a phone's battery
 * and achieve nothing the server could not get from a batch.
 *
 * Three properties the server depends on, and which have to be honoured here:
 *
 * **A stable dedupe key per logical event.** The server deduplicates on
 * `(dedupeKey, occurredAt)`. Generating a fresh key on retry would defeat that
 * entirely, so the key is created once, when the event happens, and reused for
 * every send attempt.
 *
 * **The client's own timestamp.** `occurredAt` is when the event happened on the
 * device, not when it was sent. That is what makes a retry idempotent.
 *
 * **Failed batches go back on the queue.** A dropped batch is behaviour the
 * ranking engine never learns about, so it is retried rather than discarded —
 * up to a bound, so a permanently broken backend cannot grow the queue forever.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { events as eventsApi, type EventInput } from '../api';
import { useSession } from '../store/SessionState';

/** Flush on this cadence, or sooner when the queue fills. */
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT_SIZE = 20;
/** Beyond this the oldest are dropped — a queue that grows without bound is a leak. */
const MAX_QUEUE = 200;

let counter = 0;

/** Unique per logical event, and stable across retries of that event. */
function dedupeKey(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface EventQueue {
  track: (event: string, payload?: Omit<Partial<EventInput>, 'event' | 'dedupeKey' | 'occurredAt'>) => void;
  flush: () => Promise<void>;
  pending: () => number;
}

export function useEventQueue(): EventQueue {
  const { backendStatus, isSignedIn } = useSession();
  const queue = useRef<EventInput[]>([]);
  const sending = useRef(false);

  const flush = useCallback(async () => {
    if (sending.current) return;
    if (backendStatus !== 'live' || !isSignedIn) return;
    if (queue.current.length === 0) return;

    const batch = queue.current.splice(0, FLUSH_AT_SIZE * 2);
    sending.current = true;

    try {
      await eventsApi.send(batch);
    } catch {
      // Put them back at the front so ordering is preserved, then trim from the
      // oldest end if the queue has grown past its bound.
      queue.current = [...batch, ...queue.current].slice(-MAX_QUEUE);
    } finally {
      sending.current = false;
    }
  }, [backendStatus, isSignedIn]);

  const track = useCallback<EventQueue['track']>((event, payload = {}) => {
    queue.current.push({
      event,
      // Created here, once, and reused for every retry of this event.
      dedupeKey: dedupeKey(),
      occurredAt: new Date().toISOString(),
      ...payload,
    });

    if (queue.current.length > MAX_QUEUE) {
      queue.current = queue.current.slice(-MAX_QUEUE);
    }
  }, []);

  // Periodic flush, plus an immediate one whenever the queue gets long.
  useEffect(() => {
    const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    if (queue.current.length >= FLUSH_AT_SIZE) void flush();
  });

  /**
   * A departing app would otherwise take its queue with it.
   *
   * Two different departures, because the platforms mean different things by
   * it: a browser tab closes, and an app goes to the background.
   *
   * The check is `Platform.OS`, not `typeof window`. React Native *does* define
   * a `window` global — it just has no `addEventListener` — so the old guard
   * passed on a phone and then called a function that did not exist. That threw
   * `undefined is not a function` while the feed was rendering, which closed the
   * app on the first screen after signup or login.
   */
  useEffect(() => {
    const onHide = () => void flush();

    if (Platform.OS === 'web') {
      // Guarded anyway: server-side rendering has no window at all.
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
      window.addEventListener('pagehide', onHide);
      window.addEventListener('beforeunload', onHide);
      return () => {
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('beforeunload', onHide);
      };
    }

    // On a device, backgrounding is the moment the queue is most likely to be
    // lost — the OS can kill a backgrounded app without warning.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') onHide();
    });
    return () => subscription.remove();
  }, [flush]);

  return { track, flush, pending: () => queue.current.length };
}

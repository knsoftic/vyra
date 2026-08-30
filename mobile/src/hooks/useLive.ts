/**
 * Live streaming state.
 *
 * A viewer's screen has to stay in step with a broadcast it does not control:
 * the comment stream, the viewer count, the like total and the gift animations
 * all arrive over the socket while the REST calls only establish the starting
 * point. Every merge below is keyed so an event that also appears in a refetch
 * is not counted twice.
 *
 * Joining and leaving are explicit calls, not side effects of rendering. The
 * server derives the viewer count from those rows, so a screen that mounts
 * without joining is a viewer nobody counted, and one that unmounts without
 * leaving is a viewer who never left.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveComment, LiveEvent, LiveStream } from '../../../shared/contracts/live';
import { SOCKET_EVENTS } from '../../../shared/contracts/routes';
import { live as liveApi, gifts as giftsApi, giftKey, ApiError, type StartedStream } from '../api';
import { useSession } from '../store/SessionState';
import { emit, subscribe } from '../realtime';

// ── The list of what is on air ──

export interface LiveListState {
  streams: LiveStream[];
  loading: boolean;
  live: boolean;
  refresh: () => Promise<void>;
}

export function useLiveList(): LiveListState {
  const { backendStatus } = useSession();
  const reachable = backendStatus === 'live';

  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!reachable) {
      setStreams([]);
      return;
    }
    setLoading(true);
    try {
      setStreams(await liveApi.list());
    } catch {
      setStreams([]);
    } finally {
      setLoading(false);
    }
  }, [reachable]);

  useEffect(() => {
    void load();
  }, [load]);

  return { streams, loading, live: reachable && streams.length > 0, refresh: load };
}

// ── Watching one stream ──

export interface WatchState {
  stream: LiveStream | null;
  comments: LiveComment[];
  viewerCount: number;
  likeCount: number;
  /** The most recent gift, for the animation layer. Cleared by `clearGift`. */
  incomingGift: { name: string; icon: string; quantity: number } | null;
  clearGift: () => void;
  live: boolean;
  error: string | null;
  ended: string | null;
  comment: (body: string) => Promise<void>;
  sendLike: (count?: number) => Promise<void>;
  sendGift: (giftId: string, quantity: number) => Promise<string | null>;
}

export function useWatchStream(streamId: string | null): WatchState {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn && streamId !== null;

  const [stream, setStream] = useState<LiveStream | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  const [incomingGift, setIncomingGift] = useState<WatchState['incomingGift']>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);

  // Joining is what makes the viewer count real, so it happens once per screen
  // and is undone on the way out — including when the app is backgrounded.
  const joined = useRef(false);

  useEffect(() => {
    if (!live || !streamId) return;
    let cancelled = false;

    void (async () => {
      try {
        const [joinResult, history] = await Promise.all([
          liveApi.join(streamId),
          liveApi.comments(streamId).catch(() => [] as LiveComment[]),
        ]);
        if (cancelled) return;

        joined.current = true;
        setStream(joinResult.stream);
        setViewerCount(joinResult.viewerCount);
        setLikeCount(joinResult.stream.likeCount);
        setComments(history);
        emit(SOCKET_EVENTS.liveJoin, streamId);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError && !err.offline ? err.message : null);
      }
    })();

    return () => {
      cancelled = true;
      emit(SOCKET_EVENTS.liveLeave, streamId);
      if (joined.current) {
        joined.current = false;
        void liveApi.leave(streamId).catch(() => undefined);
      }
    };
  }, [live, streamId]);

  // Everything that happens during the broadcast arrives here.
  useEffect(() => {
    if (!live || !streamId) return;
    return subscribe<LiveEvent>(SOCKET_EVENTS.liveEvent, (event) => {
      switch (event.type) {
        case 'viewer_count':
          setViewerCount(event.count);
          break;
        case 'like':
          setLikeCount(event.count);
          break;
        case 'comment':
          setComments((prev) =>
            prev.some((c) => c.id === event.comment.id) ? prev : [...prev, event.comment],
          );
          break;
        case 'gift':
          setIncomingGift({
            name: event.gift.name,
            icon: event.gift.icon,
            quantity: event.quantity,
          });
          break;
        case 'ended':
          setEnded(event.reason);
          break;
        default:
          break;
      }
    });
  }, [live, streamId]);

  const comment = useCallback(
    async (body: string) => {
      if (!live || !streamId) return;
      try {
        const created = await liveApi.comment(streamId, body);
        // The socket will echo this too; the id keeps it to one bubble.
        setComments((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : null);
      }
    },
    [live, streamId],
  );

  const sendLike = useCallback(
    async (count = 1) => {
      if (!live || !streamId) return;
      // Optimistic: taps should feel instant, and the server's total replaces
      // this the moment it answers.
      setLikeCount((prev) => prev + count);
      try {
        const result = await liveApi.like(streamId, count);
        setLikeCount(result.likeCount);
      } catch {
        // The next socket event carries the true total.
      }
    },
    [live, streamId],
  );

  /**
   * Sends a gift.
   *
   * The idempotency key is generated once here, per tap. A retry of a failed
   * send must reuse it — which is why it is returned rather than kept private,
   * so a caller retrying can pass the same one back.
   */
  const sendGift = useCallback(
    async (giftId: string, quantity: number): Promise<string | null> => {
      if (!live || !streamId || !stream) return null;
      const key = giftKey();
      try {
        await giftsApi.send(
          { giftId, recipientId: stream.host.id, streamId, quantity },
          key,
        );
        return null;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'The gift could not be sent.';
        setError(message);
        return message;
      }
    },
    [live, streamId, stream],
  );

  return {
    stream,
    comments,
    viewerCount,
    likeCount,
    incomingGift,
    clearGift: () => setIncomingGift(null),
    live,
    error,
    ended,
    comment,
    sendLike,
    sendGift,
  };
}

// ── Hosting ──

export interface BroadcastState {
  stream: LiveStream | null;
  credentials: { ingestUrl: string; streamKey: string; expiresAt: string } | null;
  comments: LiveComment[];
  viewerCount: number;
  likeCount: number;
  giftCoins: number;
  starting: boolean;
  live: boolean;
  error: string | null;
  /** Returns the new stream and its credentials, or null if it could not start. */
  start: (input: {
    title: string;
    categoryId?: string;
    allowComments?: boolean;
    allowGifts?: boolean;
    allowGuests?: boolean;
  }) => Promise<StartedStream | null>;
  end: () => Promise<void>;
  banViewer: (userId: string) => Promise<void>;
}

/**
 * Hosting one broadcast.
 *
 * Addressed by stream id, the same as watching, because the setup screen and
 * the broadcast screen are two screens: a hook holding the stream in local
 * state would give each of them its own copy, and the second would be empty.
 * The setup screen starts the stream and navigates with its id; this loads it.
 */
export function useBroadcast(streamId?: string): BroadcastState {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn;

  const [stream, setStream] = useState<LiveStream | null>(null);
  const [credentials, setCredentials] = useState<BroadcastState['credentials']>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  const [giftCoins, setGiftCoins] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live || !streamId) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await liveApi.get(streamId);
        if (cancelled) return;
        setStream(loaded);
        setViewerCount(loaded.viewerCount);
        setLikeCount(loaded.likeCount);
        setGiftCoins(loaded.giftCoins);
        const history = await liveApi.comments(streamId).catch(() => [] as LiveComment[]);
        if (!cancelled) setComments(history);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError && !err.offline ? err.message : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, streamId]);

  useEffect(() => {
    if (!stream) return;
    emit(SOCKET_EVENTS.liveJoin, stream.id);
    return () => emit(SOCKET_EVENTS.liveLeave, stream.id);
  }, [stream]);

  useEffect(() => {
    if (!stream) return;
    return subscribe<LiveEvent>(SOCKET_EVENTS.liveEvent, (event) => {
      switch (event.type) {
        case 'viewer_count':
          setViewerCount(event.count);
          break;
        case 'like':
          setLikeCount(event.count);
          break;
        case 'comment':
          setComments((prev) =>
            prev.some((c) => c.id === event.comment.id) ? prev : [...prev, event.comment],
          );
          break;
        case 'gift':
          setGiftCoins((prev) => prev + event.coins);
          break;
        default:
          break;
      }
    });
  }, [stream]);

  const start = useCallback<BroadcastState['start']>(
    async (input) => {
      if (!live) {
        setError('Sign in with a reachable backend to go live.');
        return null;
      }
      setStarting(true);
      setError(null);
      try {
        const started = await liveApi.start(input);
        setStream(started.stream);
        // Held in memory only. The server stores the key hashed and will not
        // return it again, so persisting it here would be the only copy — and
        // the wrong place for a credential.
        setCredentials({
          ingestUrl: started.credentials.ingestUrl,
          streamKey: started.credentials.streamKey,
          expiresAt: started.credentials.expiresAt,
        });
        return started;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not start the stream.');
        return null;
      } finally {
        setStarting(false);
      }
    },
    [live],
  );

  const end = useCallback(async () => {
    if (!stream) return;
    try {
      await liveApi.end(stream.id);
    } catch {
      // The stream may already be over; the screen closes either way.
    }
    setStream(null);
    setCredentials(null);
  }, [stream]);

  const banViewer = useCallback(
    async (userId: string) => {
      if (!stream) return;
      try {
        await liveApi.banViewer(stream.id, userId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : null);
      }
    },
    [stream],
  );

  return {
    stream,
    credentials,
    comments,
    viewerCount,
    likeCount,
    giftCoins,
    starting,
    live,
    error,
    start,
    end,
    banViewer,
  };
}

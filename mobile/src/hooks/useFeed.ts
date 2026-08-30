/**
 * Feed data.
 *
 * Fetches the For You feed from the recommendation engine and adapts it to the
 * `Video` shape the existing feed components already render, so the UI built in
 * Phase 1 works unchanged against live data.
 *
 * When the backend is unreachable it falls back to the sample videos and says
 * so through `source`. That distinction matters: showing sample data silently
 * would make the app look like it works when it does not, and showing an error
 * would make the UI impossible to develop against without a running server.
 */

import { useCallback, useEffect, useState } from 'react';
import { feed as feedApi, ApiError, type FeedVideo } from '../api';
import { useSession } from '../store/SessionState';
import { forYouVideos, followingVideos, trendingVideos } from '../mock';
import type { Video } from '../types';

export type FeedTab = 'following' | 'for_you' | 'trending';
export type FeedSource = 'live' | 'sample';

interface FeedState {
  videos: Video[];
  source: FeedSource;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Which ranker served this — 'rules' when the ML service is unavailable. */
  ranker: 'ml' | 'rules' | null;
  refresh: () => Promise<void>;
}

const sampleFor = (tab: FeedTab): Video[] => {
  if (tab === 'following') return followingVideos;
  if (tab === 'trending') return trendingVideos;
  return forYouVideos;
};

/**
 * Maps a server feed item onto the client's `Video`.
 *
 * The two shapes differ because the client one was designed for the UI and the
 * server one for ranking. Adapting here keeps that difference in a single place
 * rather than spreading server field names through the components.
 */
function toVideo(item: FeedVideo, index: number): Video {
  return {
    id: item.id,
    author: {
      id: item.author.username,
      username: item.author.username,
      displayName: item.author.displayName,
      avatar: item.author.avatar ?? `https://i.pravatar.cc/150?u=${item.author.username}`,
      bio: '',
      accountCategory: 'individual',
      accountType: 'creator',
      verification: 'none',
      followers: 0,
      following: 0,
      likes: 0,
      videos: 0,
      isFollowing: false,
    },
    caption: item.caption,
    hashtags: [],
    mentions: [],
    sound: {
      id: `sound_${item.id}`,
      title: 'Original sound',
      artist: item.author.displayName,
      cover: item.posterUrl ?? '',
      durationSec: item.durationSec,
      isOriginal: true,
    },
    // A processed video has an HLS manifest; until it does, the poster stands in
    // and the player shows a still rather than failing to load.
    url: item.hlsUrl ?? '',
    poster: item.posterUrl ?? `https://picsum.photos/seed/${item.id}/400/720`,
    durationSec: item.durationSec,
    privacy: 'public',
    interaction: {
      allowComments: true,
      allowShare: true,
      allowDownload: true,
      allowRemix: true,
      allowDuet: true,
    },
    stats: {
      views: item.stats.views,
      likes: item.stats.likes,
      comments: item.stats.comments,
      shares: item.stats.shares,
      saves: 0,
    },
    liked: false,
    saved: false,
    category: 'general',
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    feedSource: 'for_you',
    // Carried from the server so the item renders its "Promoted" label. An
    // advertisement that reaches the screen without this is indistinguishable
    // from organic content, which is the one outcome the delivery design
    // refuses to allow (ADR-035).
    ...(item.isPromoted ? { isPromoted: true } : {}),
  };
}

export function useFeed(tab: FeedTab): FeedState {
  const { backendStatus, isSignedIn } = useSession();
  const [videos, setVideos] = useState<Video[]>(() => sampleFor(tab));
  const [source, setSource] = useState<FeedSource>('sample');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranker, setRanker] = useState<'ml' | 'rules' | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      // The feed needs a session; signed out, the samples are the honest answer.
      if (backendStatus !== 'live' || !isSignedIn) {
        setVideos(sampleFor(tab));
        setSource('sample');
        setRanker(null);
        return;
      }

      // Only For You is served by the recommendation engine today. Following and
      // Trending keep their samples rather than pretending to be personalised.
      if (tab !== 'for_you') {
        setVideos(sampleFor(tab));
        setSource('sample');
        return;
      }

      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const result = await feedApi.forYou(10);
        setRanker(result.ranker);

        if (result.items.length === 0) {
          // A real but empty feed. Samples keep the screen useful while the
          // platform has no content, and `source` still reports the truth.
          setVideos(sampleFor(tab));
          setSource('sample');
          return;
        }

        setVideos(result.items.map(toVideo));
        setSource('live');
      } catch (err) {
        setVideos(sampleFor(tab));
        setSource('sample');
        setError(
          err instanceof ApiError && !err.offline ? err.message : null,
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab, backendStatus, isSignedIn],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { videos, source, loading, refreshing, error, ranker, refresh };
}

import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { User, Video, Sound, VideoPrivacy, VideoInteractionSettings } from '../types';
import { currentUser, videos as mockVideos, walletBalance, filters, adjustmentControls } from '../mock';

/**
 * App-level state for Phase 1.
 *
 * Deliberately a small React context rather than a state library: the only state
 * that must be shared across screens right now is the session, the compose draft
 * and locally toggled interactions. Phase 3 replaces the session and interaction
 * parts with server state (TanStack Query) and keeps the compose draft local.
 */

// ─────────────────────────────── Session ────────────────────────────────

interface SessionState {
  isAuthenticated: boolean;
  user: User;
  coins: number;
  signIn: () => void;
  signOut: () => void;
  setUser: (user: User) => void;
}

// ───────────────────────── Compose (create) draft ───────────────────────

export interface ComposeState {
  /** Clips captured or picked, in timeline order. */
  clips: { id: string; thumb: string; durationSec: number; speed: number }[];
  filterId: string;
  adjustments: Record<string, number>;
  effectIds: string[];
  sound?: Sound;
  volumes: { original: number; music: number; voice: number };
  textOverlays: { id: string; text: string; color: string; font: string }[];
  stickers: { id: string; emoji: string }[];
  coverFrameId?: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  location?: string;
  privacy: VideoPrivacy;
  interaction: VideoInteractionSettings;
}

interface ComposeActions {
  compose: ComposeState;
  setCompose: (patch: Partial<ComposeState>) => void;
  setAdjustment: (id: string, value: number) => void;
  resetAdjustments: () => void;
  toggleEffect: (id: string) => void;
  resetCompose: () => void;
}

// ──────────────────────── Local interaction state ───────────────────────

interface InteractionState {
  likedIds: Set<string>;
  savedIds: Set<string>;
  followingIds: Set<string>;
  toggleLike: (videoId: string) => void;
  toggleSave: (videoId: string) => void;
  toggleFollow: (userId: string) => void;
  isLiked: (video: Video) => boolean;
  isSaved: (video: Video) => boolean;
  isFollowing: (user: User) => boolean;
}

type AppContextValue = SessionState & ComposeActions & InteractionState;

const AppContext = createContext<AppContextValue | undefined>(undefined);

const defaultAdjustments = Object.fromEntries(
  adjustmentControls.map((control) => [control.id, control.defaultValue]),
);

const emptyCompose = (): ComposeState => ({
  clips: [],
  filterId: filters[0].id,
  adjustments: { ...defaultAdjustments },
  effectIds: [],
  volumes: { original: 100, music: 60, voice: 80 },
  textOverlays: [],
  stickers: [],
  caption: '',
  hashtags: [],
  mentions: [],
  privacy: 'public',
  interaction: {
    allowComments: true,
    allowShare: true,
    allowDownload: true,
    allowRemix: true,
    allowDuet: true,
  },
});

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User>(currentUser);
  const [compose, setComposeState] = useState<ComposeState>(emptyCompose);

  const [likedIds, setLikedIds] = useState<Set<string>>(
    () => new Set(mockVideos.filter((v) => v.liked).map((v) => v.id)),
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(
    () => new Set(mockVideos.filter((v) => v.saved).map((v) => v.id)),
  );
  const [followingIds, setFollowingIds] = useState<Set<string>>(
    () => new Set(mockVideos.filter((v) => v.author.isFollowing).map((v) => v.author.id)),
  );

  const signIn = useCallback(() => setIsAuthenticated(true), []);
  const signOut = useCallback(() => setIsAuthenticated(false), []);

  const setCompose = useCallback((patch: Partial<ComposeState>) => {
    setComposeState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setAdjustment = useCallback((id: string, value: number) => {
    setComposeState((prev) => ({ ...prev, adjustments: { ...prev.adjustments, [id]: value } }));
  }, []);

  const resetAdjustments = useCallback(() => {
    setComposeState((prev) => ({ ...prev, adjustments: { ...defaultAdjustments } }));
  }, []);

  const toggleEffect = useCallback((id: string) => {
    setComposeState((prev) => ({
      ...prev,
      effectIds: prev.effectIds.includes(id)
        ? prev.effectIds.filter((e) => e !== id)
        : [...prev.effectIds, id],
    }));
  }, []);

  const resetCompose = useCallback(() => setComposeState(emptyCompose()), []);

  const toggleInSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLike = useCallback((videoId: string) => toggleInSet(setLikedIds, videoId), []);
  const toggleSave = useCallback((videoId: string) => toggleInSet(setSavedIds, videoId), []);
  const toggleFollow = useCallback((userId: string) => toggleInSet(setFollowingIds, userId), []);

  const isLiked = useCallback((video: Video) => likedIds.has(video.id), [likedIds]);
  const isSaved = useCallback((video: Video) => savedIds.has(video.id), [savedIds]);
  const isFollowing = useCallback((u: User) => followingIds.has(u.id), [followingIds]);

  const value = useMemo<AppContextValue>(
    () => ({
      isAuthenticated,
      user,
      coins: walletBalance,
      signIn,
      signOut,
      setUser,
      compose,
      setCompose,
      setAdjustment,
      resetAdjustments,
      toggleEffect,
      resetCompose,
      likedIds,
      savedIds,
      followingIds,
      toggleLike,
      toggleSave,
      toggleFollow,
      isLiked,
      isSaved,
      isFollowing,
    }),
    [
      isAuthenticated,
      user,
      compose,
      setCompose,
      setAdjustment,
      resetAdjustments,
      toggleEffect,
      resetCompose,
      signIn,
      signOut,
      likedIds,
      savedIds,
      followingIds,
      toggleLike,
      toggleSave,
      toggleFollow,
      isLiked,
      isSaved,
      isFollowing,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppStateProvider>');
  return ctx;
}

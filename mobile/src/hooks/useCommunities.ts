/**
 * Community state.
 *
 * The one thing worth care here is ADR-014: the roster the server returns to an
 * ordinary member is deliberately only the staff. `restricted` comes back with
 * it, and the screens must show that rather than presenting four people as the
 * whole community.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  Community as ApiCommunity,
  CommunityJoinRequest,
  CommunityMember,
} from '../../../shared/contracts/messaging';
import { communities as communitiesApi, ApiError } from '../api';
import { useSession } from '../store/SessionState';
import type { Community, CommunityRole, User } from '../types';

/** The server community as the UI type. */
export function toCommunity(source: ApiCommunity): Community {
  return {
    id: source.id,
    name: source.name,
    logo: source.avatar ?? `https://picsum.photos/seed/${source.id}/200/200`,
    ...(source.banner ? { banner: source.banner } : {}),
    description: source.description,
    rules: source.rules,
    isPrivate: source.isPrivate,
    memberCount: source.memberCount,
    // Absent means "not a member". The UI type wants a role, and `member` is
    // the least-privileged one, so a non-member is never shown staff controls.
    myRole: (source.myRole ?? 'member') as CommunityRole,
    permissions: source.permissions,
  };
}

export function toMemberUser(member: CommunityMember): User {
  return {
    id: member.user.id,
    username: member.user.username,
    displayName: member.user.displayName,
    avatar: member.user.avatar ?? `https://i.pravatar.cc/150?u=${member.user.username}`,
    bio: member.user.bio,
    accountCategory: member.user.accountCategory,
    accountType: member.user.accountType as User['accountType'],
    verification: member.user.verificationTier,
    followers: member.user.followers,
    following: member.user.following,
    likes: member.user.likes,
    videos: member.user.videos,
  };
}

export interface CommunityListState {
  communities: Community[];
  /** The server rows, for anything the UI type does not carry. */
  raw: ApiCommunity[];
  loading: boolean;
  live: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCommunityList(options: { mine?: boolean } = {}): CommunityListState {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn;

  const [raw, setRaw] = useState<ApiCommunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!live) {
      setRaw([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await communitiesApi.list({ ...(options.mine ? { mine: true } : {}) });
      setRaw(page.items);
    } catch (err) {
      setError(err instanceof ApiError && !err.offline ? err.message : null);
    } finally {
      setLoading(false);
    }
  }, [live, options.mine]);

  useEffect(() => {
    void load();
  }, [load]);

  return { communities: raw.map(toCommunity), raw, loading, live, error, refresh: load };
}

export interface CommunityDetailState {
  community: Community | null;
  raw: ApiCommunity | null;
  members: CommunityMember[];
  /** True when the roster shown is staff-only rather than everyone (ADR-014). */
  restricted: boolean;
  requests: CommunityJoinRequest[];
  loading: boolean;
  live: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  join: (message?: string) => Promise<void>;
  leave: () => Promise<void>;
  decide: (requestId: string, approve: boolean) => Promise<void>;
  moderate: (userId: string, patch: { muted?: boolean; banned?: boolean }) => Promise<void>;
}

export function useCommunity(communityId: string | null): CommunityDetailState {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn && communityId !== null;

  const [raw, setRaw] = useState<ApiCommunity | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [restricted, setRestricted] = useState(true);
  const [requests, setRequests] = useState<CommunityJoinRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!live || !communityId) {
      setRaw(null);
      setMembers([]);
      setRequests([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await communitiesApi.get(communityId);
      setRaw(detail);

      const roster = await communitiesApi.members(communityId);
      setMembers(roster.items);
      setRestricted(roster.restricted ?? true);

      // Staff only. A member asking gets 403, which is correct and not an error
      // worth showing them.
      const staff = detail.myRole && detail.myRole !== 'member';
      if (staff) {
        const pending = await communitiesApi.requests(communityId).catch(() => []);
        setRequests(pending);
      } else {
        setRequests([]);
      }
    } catch (err) {
      setError(err instanceof ApiError && !err.offline ? err.message : null);
    } finally {
      setLoading(false);
    }
  }, [live, communityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = useCallback(
    async (message?: string) => {
      if (!live || !communityId) return;
      try {
        await communitiesApi.join(communityId, message);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : null);
      }
    },
    [live, communityId, load],
  );

  const leave = useCallback(async () => {
    if (!live || !communityId) return;
    try {
      await communitiesApi.leave(communityId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : null);
    }
  }, [live, communityId, load]);

  const decide = useCallback(
    async (requestId: string, approve: boolean) => {
      if (!live || !communityId) return;
      // Removed from the list straight away; the reload confirms it.
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      try {
        await communitiesApi.decideRequest(communityId, requestId, approve);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : null);
        await load();
      }
    },
    [live, communityId, load],
  );

  const moderate = useCallback(
    async (userId: string, patch: { muted?: boolean; banned?: boolean }) => {
      if (!live || !communityId) return;
      try {
        await communitiesApi.moderate(communityId, userId, patch);
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : null);
      }
    },
    [live, communityId, load],
  );

  return {
    community: raw ? toCommunity(raw) : null,
    raw,
    members,
    restricted,
    requests,
    loading,
    live,
    error,
    refresh: load,
    join,
    leave,
    decide,
    moderate,
  };
}

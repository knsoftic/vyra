/** Chat, group, community and call contract. */

import type { Page } from './http.ts';
import type { PublicUser } from './user.ts';

/**
 * Three kinds, matching the `chats.kind` column and the mobile types.
 *
 * This said `'direct' | 'group'` while the database and the app both said
 * `'private' | 'group' | 'community'`. A contract that agrees with neither end
 * is worse than no contract, because it type-checks and then fails at runtime.
 */
export type ChatKind = 'private' | 'group' | 'community';

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'voice'
  | 'shared_video'
  | 'system';

/**
 * What the sender sees.
 *
 * `sending` and `failed` are client-only — the server never stores them, since
 * a message the server knows about has by definition been sent.
 */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'seen' | 'failed';

export interface MessageReplyPreview {
  id: string;
  senderName: string;
  preview: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  kind: MessageKind;
  body?: string;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  /** Voice and video notes. Recorded with an explicit, one-off mic permission. */
  durationSec?: number;
  replyTo?: MessageReplyPreview;
  /** The video attached to a `shared_video` message. */
  sharedVideoId?: string;
  status: MessageStatus;
  /** Set when the message was withdrawn for everyone; `body` is then absent. */
  isDeleted?: boolean;
  createdAt: string;
}

export interface ChatParticipant extends PublicUser {
  role: ChatRole;
  isMuted: boolean;
}

export type ChatRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface Chat {
  id: string;
  kind: ChatKind;
  title: string;
  avatar?: string;
  description?: string;
  participants: ChatParticipant[];
  lastMessage?: Message;
  unreadCount: number;
  isMuted: boolean;
  /** Private chats only: whether the other person has a socket open. */
  isOnline?: boolean;
  myRole: ChatRole;
  memberCount: number;
  pinnedMessageId?: string;
  updatedAt: string;
}

export interface SendMessageBody {
  kind: MessageKind;
  body?: string;
  mediaKey?: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  replyToId?: string;
  sharedVideoId?: string;
  /** Client-generated, so a retry after a dropped connection does not duplicate. */
  clientId: string;
}

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface CommunityPermissions {
  canPost: boolean;
  canComment: boolean;
  canSendMedia: boolean;
  canSendLinks: boolean;
  canInvite: boolean;
}

export interface Community {
  id: string;
  /** The chat this community talks in. */
  chatId: string;
  name: string;
  description: string;
  avatar?: string;
  banner?: string;
  rules: string[];
  announcement?: string;
  memberCount: number;
  isPrivate: boolean;
  permissions: CommunityPermissions;
  /** The caller's role, or absent if not a member. */
  myRole?: CommunityRole;
  /** Set when the caller has a join request awaiting a decision. */
  joinRequestPending?: boolean;
  createdAt: string;
}

/**
 * ADR-014 — ordinary members cannot enumerate the roster. The list endpoint
 * returns only staff to a member; the full roster requires a staff role.
 */
export interface CommunityMember {
  user: PublicUser;
  role: CommunityRole;
  isMuted: boolean;
  isBanned: boolean;
  joinedAt: string;
}

export interface CommunityJoinRequest {
  id: string;
  user: PublicUser;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export type CallKind = 'voice' | 'video';
export type CallState = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'failed';

export interface CallRecord {
  id: string;
  chatId: string;
  kind: CallKind;
  isGroup: boolean;
  initiatorId: string;
  peers: PublicUser[];
  state: CallState;
  /** True when the caller placed this call rather than received it. */
  outgoing: boolean;
  /** Mic and camera are opened only after the callee accepts. */
  startedAt?: string;
  endedAt?: string;
  durationSec: number;
  createdAt: string;
}

export type ChatPage = Page<Chat>;
export type MessagePage = Page<Message>;
export type CommunityPage = Page<Community>;

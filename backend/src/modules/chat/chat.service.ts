/**
 * Chat.
 *
 * Three things decide whether a message is allowed, and they are checked in the
 * same order every time:
 *
 *   1. **Membership.** You can only read or write in a chat you belong to. This
 *      is checked against `chat_participants`, never inferred from the client
 *      having a chat id — ids are guessable and a leaked one must not be a key.
 *   2. **Blocks.** Symmetric. If either party has blocked the other, the private
 *      chat behaves as though the account is gone.
 *   3. **The recipient's `whoCanMessage` setting.** This is where the privacy
 *      screen from Phase 6 actually bites: it is enforced here, at the point a
 *      conversation is opened, rather than being a label on a settings page.
 *
 * Delivery is at-least-once from the client's point of view, so sends carry a
 * client-generated id and a repeat returns the original message rather than a
 * second one (ADR-020).
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import { buildPage, decodeCursor, normaliseLimit } from '../../core/pagination.ts';
import { storage } from '../../core/storage.ts';
import { keys } from '../../core/redis.ts';
import { cache } from '../../core/cache.ts';
import { logger } from '../../core/logger.ts';
import * as social from '../social/social.service.ts';
import type {
  Chat,
  ChatKind,
  ChatParticipant,
  ChatRole,
  Message,
  MessageKind,
  SendMessageBody,
} from '../../../../shared/contracts/messaging.ts';
import type { Page } from '../../../../shared/contracts/http.ts';

// ── Row shapes ──

interface ChatRow {
  id: number;
  public_id: string;
  kind: ChatKind;
  title: string | null;
  avatar_url: string | null;
  description: string | null;
  owner_id: number | null;
  pinned_message_id: number | null;
  member_count: number;
  last_message_at: Date | null;
  updated_at: Date;
  my_role: ChatRole;
  is_muted: number;
  unread_count: number;
}

interface MessageRow {
  id: number;
  public_id: string;
  chat_public_id: string;
  sender_public_id: string;
  kind: MessageKind;
  body: string | null;
  media_key: string | null;
  file_name: string | null;
  file_size: string | null;
  duration_sec: number | null;
  reply_to_public_id: string | null;
  reply_to_body: string | null;
  reply_to_sender: string | null;
  shared_video_public_id: string | null;
  deleted_for_all_at: Date | null;
  created_at: Date;
  delivered_count?: number;
  seen_count?: number;
}

// ── Membership ──

export interface Membership {
  chatId: number;
  chatPublicId: string;
  kind: ChatKind;
  role: ChatRole;
  isMuted: boolean;
}

/**
 * Resolves a chat's public id to a membership, or refuses.
 *
 * A non-member gets `not_found`, not `forbidden`. "You are not allowed in this
 * chat" confirms the chat exists and that these people are talking, which is
 * exactly what someone probing ids is trying to learn.
 */
export async function requireMembership(
  userId: number,
  chatPublicId: string,
): Promise<Membership> {
  const row = await queryOne<{
    id: number;
    kind: ChatKind;
    role: ChatRole;
    is_muted: number;
  }>(
    `SELECT c.id, c.kind, p.role, p.is_muted
       FROM chats c
       JOIN chat_participants p ON p.chat_id = c.id AND p.user_id = :userId
      WHERE c.public_id = :publicId
        AND c.deleted_at IS NULL
        AND p.left_at IS NULL`,
    { userId, publicId: chatPublicId },
  );

  if (!row) throw new AppError('not_found', 'Conversation not found.');

  return {
    chatId: row.id,
    chatPublicId,
    kind: row.kind,
    role: row.role,
    isMuted: row.is_muted === 1,
  };
}

/** Staff can rename a group, manage members and pin. Members cannot. */
export function assertStaff(membership: Membership): void {
  if (membership.role === 'member') {
    throw new AppError('forbidden', 'Only group admins can do that.');
  }
}

// ── Who may message whom ──

/**
 * Whether `senderId` is allowed to open a conversation with `recipientId`.
 *
 * `whoCanMessage` is the recipient's setting, so it is read from their profile,
 * never from the sender's. The "followers" case means *the recipient's*
 * followers: someone the recipient has chosen to be visible to.
 */
export async function assertCanMessage(senderId: number, recipientId: number): Promise<void> {
  if (senderId === recipientId) return;

  if (await social.isBlockedEitherWay(senderId, recipientId)) {
    // Same answer as a deleted account, for the same reason as everywhere else.
    throw new AppError('not_found', 'Account not found.');
  }

  const recipient = await queryOne<{ who_can_message: 'everyone' | 'followers' | 'nobody' }>(
    `SELECT p.who_can_message
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = :id AND u.deleted_at IS NULL AND u.status <> 'banned'`,
    { id: recipientId },
  );
  if (!recipient) throw new AppError('not_found', 'Account not found.');

  if (recipient.who_can_message === 'nobody') {
    throw new AppError('forbidden', 'This account is not accepting messages.');
  }

  if (recipient.who_can_message === 'followers') {
    // The sender must be someone the recipient follows — that is what makes the
    // recipient's own follow list the gate rather than the sender's.
    const followed = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM follows
        WHERE follower_id = :recipient AND followee_id = :sender AND deleted_at IS NULL`,
      { recipient: recipientId, sender: senderId },
    );
    if (Number(followed?.c ?? 0) === 0) {
      throw new AppError('forbidden', 'This account only accepts messages from people it follows.');
    }
  }
}

// ── Mapping ──

function toParticipant(row: {
  public_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  verification_tier: string;
  account_category: string;
  account_type: string;
  follower_count: number;
  following_count: number;
  like_count: number;
  video_count: number;
  is_private: number;
  created_at: Date;
  role: ChatRole;
  is_muted: number;
}): ChatParticipant {
  const participant: ChatParticipant = {
    id: row.public_id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio ?? '',
    verified: row.verification_tier !== 'none',
    verificationTier: row.verification_tier as ChatParticipant['verificationTier'],
    accountCategory: row.account_category as ChatParticipant['accountCategory'],
    accountType: row.account_type as ChatParticipant['accountType'],
    followers: Number(row.follower_count),
    following: Number(row.following_count),
    likes: Number(row.like_count),
    videos: Number(row.video_count),
    isPrivate: row.is_private === 1,
    createdAt: new Date(row.created_at).toISOString(),
    role: row.role,
    isMuted: row.is_muted === 1,
  };
  if (row.avatar_url) participant.avatar = row.avatar_url;
  return participant;
}

/**
 * A message row as the client sees it.
 *
 * `status` is derived from the receipts of *other* participants, so the sender
 * sees one tick or two. A withdrawn message keeps its place in the thread but
 * loses its content — removing the row entirely would renumber replies that
 * point at it.
 */
function toMessage(row: MessageRow, viewerIsSender: boolean): Message {
  const withdrawn = row.deleted_for_all_at !== null;

  const message: Message = {
    id: row.public_id,
    chatId: row.chat_public_id,
    senderId: row.sender_public_id,
    kind: withdrawn ? 'system' : row.kind,
    status: 'sent',
    createdAt: new Date(row.created_at).toISOString(),
  };

  if (withdrawn) {
    message.isDeleted = true;
    return message;
  }

  if (row.body !== null) message.body = row.body;
  if (row.media_key) message.mediaUrl = storage.url(row.media_key);
  if (row.file_name) message.fileName = row.file_name;
  if (row.file_size !== null) message.fileSize = Number(row.file_size);
  if (row.duration_sec !== null) message.durationSec = row.duration_sec;
  if (row.shared_video_public_id) message.sharedVideoId = row.shared_video_public_id;

  if (row.reply_to_public_id) {
    message.replyTo = {
      id: row.reply_to_public_id,
      senderName: row.reply_to_sender ?? 'Unknown',
      preview: (row.reply_to_body ?? '').slice(0, 120),
    };
  }

  // Only the sender is shown delivery state; a recipient has no use for it and
  // it would leak when other people opened the chat.
  if (viewerIsSender) {
    if (Number(row.seen_count ?? 0) > 0) message.status = 'seen';
    else if (Number(row.delivered_count ?? 0) > 0) message.status = 'delivered';
  }

  return message;
}

const PARTICIPANT_COLUMNS = `
  u.public_id, u.username, u.verification_tier, u.account_category, u.account_type, u.created_at,
  pr.display_name, pr.avatar_url, pr.bio, pr.follower_count, pr.following_count,
  pr.like_count, pr.video_count, pr.is_private,
  cp.role, cp.is_muted
`;

async function participantsFor(chatIds: number[]): Promise<Map<number, ChatParticipant[]>> {
  const map = new Map<number, ChatParticipant[]>();
  if (chatIds.length === 0) return map;

  const rows = await query<Parameters<typeof toParticipant>[0] & { chat_id: number }>(
    `SELECT cp.chat_id, ${PARTICIPANT_COLUMNS}
       FROM chat_participants cp
       JOIN users u ON u.id = cp.user_id
       JOIN user_profiles pr ON pr.user_id = cp.user_id
      WHERE cp.chat_id IN (${chatIds.map(() => '?').join(',')})
        AND cp.left_at IS NULL
        AND u.deleted_at IS NULL
      ORDER BY FIELD(cp.role, 'owner', 'admin', 'moderator', 'member'), cp.joined_at`,
    chatIds,
  );

  for (const row of rows) {
    const list = map.get(row.chat_id) ?? [];
    list.push(toParticipant(row));
    map.set(row.chat_id, list);
  }
  return map;
}

/**
 * Presence for a set of users.
 *
 * Redis holds the online set. When it is unavailable everyone reads as offline
 * rather than as online: a wrong "online" invites someone to expect an instant
 * reply that is not coming, and it also discloses more than a wrong "offline".
 */
async function onlineUsers(publicIds: string[]): Promise<Set<string>> {
  if (publicIds.length === 0) return new Set();
  try {
    const members = await cache.smembers(keys.onlineUsers());
    // Nothing online means no lookup is worth doing — and when the breaker is
    // open this is the empty set, so the query is skipped entirely.
    if (members.length === 0) return new Set();

    const rows = await query<{ id: number; public_id: string }>(
      `SELECT id, public_id FROM users WHERE public_id IN (${publicIds.map(() => '?').join(',')})`,
      publicIds,
    );
    const set = new Set(members);
    const online = new Set<string>();
    for (const row of rows) {
      if (set.has(String(row.id))) online.add(row.public_id);
    }
    return online;
  } catch {
    return new Set();
  }
}

// ── Reads ──

const CHAT_SELECT = `
  SELECT c.id, c.public_id, c.kind, c.title, c.avatar_url, c.description, c.owner_id,
         c.pinned_message_id, c.member_count, c.last_message_at, c.updated_at,
         p.role AS my_role, p.is_muted, p.unread_count
    FROM chats c
    JOIN chat_participants p ON p.chat_id = c.id AND p.user_id = :userId
   WHERE c.deleted_at IS NULL AND p.left_at IS NULL
`;

async function lastMessagesFor(chatIds: number[], viewerId: number): Promise<Map<number, Message>> {
  const map = new Map<number, Message>();
  if (chatIds.length === 0) return map;

  // The newest message per chat. `last_message_at` on the chat row is the
  // pointer; the join brings back the message it names.
  const rows = await query<MessageRow & { chat_id: number; sender_id: number }>(
    `SELECT m.id, m.public_id, m.chat_id, m.sender_id, m.kind, m.body, m.media_key,
            m.file_name, m.file_size, m.duration_sec, m.deleted_for_all_at, m.created_at,
            c.public_id AS chat_public_id,
            su.public_id AS sender_public_id,
            NULL AS reply_to_public_id, NULL AS reply_to_body, NULL AS reply_to_sender,
            NULL AS shared_video_public_id
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN users su ON su.id = m.sender_id
      WHERE m.chat_id IN (${chatIds.map(() => '?').join(',')})
        AND m.deleted_at IS NULL
        AND m.id = (SELECT MAX(m2.id) FROM messages m2
                     WHERE m2.chat_id = m.chat_id AND m2.deleted_at IS NULL)`,
    chatIds,
  );

  for (const row of rows) {
    map.set(row.chat_id, toMessage(row, row.sender_id === viewerId));
  }
  return map;
}

async function assembleChats(rows: ChatRow[], viewerId: number): Promise<Chat[]> {
  const ids = rows.map((r) => r.id);
  const [participants, lastMessages] = await Promise.all([
    participantsFor(ids),
    lastMessagesFor(ids, viewerId),
  ]);

  const otherIds = rows
    .filter((r) => r.kind === 'private')
    .flatMap((r) => (participants.get(r.id) ?? []).map((p) => p.id));
  const online = await onlineUsers(otherIds);

  const viewer = await queryOne<{ public_id: string }>(
    'SELECT public_id FROM users WHERE id = :id',
    { id: viewerId },
  );

  return rows.map((row) => {
    const people = participants.get(row.id) ?? [];
    const others = people.filter((p) => p.id !== viewer?.public_id);

    // A private chat is titled and pictured by the other person, not by a row
    // in the database — otherwise a renamed account keeps its old name here.
    const other = others[0];
    const title =
      row.kind === 'private' ? (other?.displayName ?? 'Conversation') : (row.title ?? 'Group');
    const avatar = row.kind === 'private' ? other?.avatar : (row.avatar_url ?? undefined);

    const chat: Chat = {
      id: row.public_id,
      kind: row.kind,
      title,
      participants: people,
      unreadCount: Number(row.unread_count),
      isMuted: row.is_muted === 1,
      myRole: row.my_role,
      memberCount: Number(row.member_count),
      updatedAt: new Date(row.last_message_at ?? row.updated_at).toISOString(),
    };

    if (avatar) chat.avatar = avatar;
    if (row.description) chat.description = row.description;

    const last = lastMessages.get(row.id);
    if (last) chat.lastMessage = last;

    if (row.kind === 'private' && other) chat.isOnline = online.has(other.id);

    return chat;
  });
}

/** The inbox: every conversation the caller is in, newest activity first. */
export async function listChats(
  userId: number,
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<Page<Chat>> {
  const limit = normaliseLimit(limitRaw);
  const scope = `chats:${userId}`;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;

  const rows = await query<ChatRow>(
    `${CHAT_SELECT}
       ${after ? 'AND COALESCE(c.last_message_at, c.updated_at) < :afterAt' : ''}
     ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC, c.id DESC
     LIMIT :limit`,
    {
      userId,
      limit: limit + 1,
      ...(after ? { afterAt: new Date(Number(after.k)) } : {}),
    },
  );

  const page = buildPage<ChatRow>(rows, limit, scope, (row) => ({
    k: new Date(row.last_message_at ?? row.updated_at).getTime(),
    id: String(row.id),
    s: scope,
  }));

  return {
    items: await assembleChats(page.items, userId),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export async function getChat(userId: number, chatPublicId: string): Promise<Chat> {
  await requireMembership(userId, chatPublicId);

  const rows = await query<ChatRow>(`${CHAT_SELECT} AND c.public_id = :publicId`, {
    userId,
    publicId: chatPublicId,
  });
  const assembled = await assembleChats(rows, userId);
  const chat = assembled[0];
  if (!chat) throw new AppError('not_found', 'Conversation not found.');
  return chat;
}

/**
 * Message history, newest first.
 *
 * Messages sent before the caller joined are not returned. Someone added to a
 * group today has not been given the right to read what was said last year.
 */
export async function listMessages(
  userId: number,
  chatPublicId: string,
  cursor: string | undefined,
  limitRaw: unknown,
): Promise<Page<Message>> {
  const membership = await requireMembership(userId, chatPublicId);
  const limit = normaliseLimit(limitRaw);
  const scope = `messages:${membership.chatId}`;
  const after = cursor ? decodeCursor(cursor, scope) : undefined;

  const rows = await query<MessageRow & { sender_id: number }>(
    `SELECT m.id, m.public_id, m.sender_id, m.kind, m.body, m.media_key, m.file_name,
            m.file_size, m.duration_sec, m.deleted_for_all_at, m.created_at,
            c.public_id AS chat_public_id,
            su.public_id AS sender_public_id,
            rm.public_id AS reply_to_public_id,
            rm.body AS reply_to_body,
            rp.display_name AS reply_to_sender,
            sv.public_id AS shared_video_public_id,
            (SELECT COUNT(*) FROM message_receipts r
              WHERE r.message_id = m.id AND r.user_id <> m.sender_id
                AND r.delivered_at IS NOT NULL) AS delivered_count,
            (SELECT COUNT(*) FROM message_receipts r
              WHERE r.message_id = m.id AND r.user_id <> m.sender_id
                AND r.seen_at IS NOT NULL) AS seen_count
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN users su ON su.id = m.sender_id
       JOIN chat_participants me ON me.chat_id = m.chat_id AND me.user_id = :userId
       LEFT JOIN messages rm ON rm.id = m.reply_to_id
       LEFT JOIN user_profiles rp ON rp.user_id = rm.sender_id
       LEFT JOIN videos sv ON sv.id = m.shared_video_id
      WHERE m.chat_id = :chatId
        AND m.deleted_at IS NULL
        AND m.created_at >= me.joined_at
        AND NOT EXISTS (SELECT 1 FROM message_receipts h
                         WHERE h.message_id = m.id AND h.user_id = :userId
                           AND h.hidden_at IS NOT NULL)
        ${after ? 'AND m.id < :afterId' : ''}
      ORDER BY m.id DESC
      LIMIT :limit`,
    {
      userId,
      chatId: membership.chatId,
      limit: limit + 1,
      ...(after ? { afterId: Number(after.id) } : {}),
    },
  );

  const page = buildPage(rows, limit, scope, (row) => ({
    k: new Date(row.created_at).getTime(),
    id: String(row.id),
    s: scope,
  }));

  return {
    items: page.items.map((row) => toMessage(row, row.sender_id === userId)),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

// ── Writes ──

/**
 * Opens the private chat with someone, creating it if it does not exist.
 *
 * Idempotent: two people tapping "message" at the same moment must end up in the
 * same conversation, not two. The lookup finds any existing private chat with
 * exactly these two participants.
 */
export async function openDirectChat(userId: number, otherPublicId: string): Promise<Chat> {
  const other = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE public_id = :publicId AND deleted_at IS NULL',
    { publicId: otherPublicId },
  );
  if (!other) throw new AppError('not_found', 'Account not found.');
  if (other.id === userId) throw new AppError('bad_request', 'You cannot message yourself.');

  await assertCanMessage(userId, other.id);

  const existing = await queryOne<{ public_id: string }>(
    `SELECT c.public_id
       FROM chats c
       JOIN chat_participants a ON a.chat_id = c.id AND a.user_id = :me AND a.left_at IS NULL
       JOIN chat_participants b ON b.chat_id = c.id AND b.user_id = :other AND b.left_at IS NULL
      WHERE c.kind = 'private' AND c.deleted_at IS NULL
      LIMIT 1`,
    { me: userId, other: other.id },
  );
  if (existing) return getChat(userId, existing.public_id);

  const publicId = ulid();
  await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO chats (public_id, kind, owner_id, member_count)
       VALUES (:publicId, 'private', :owner, 2)`,
      { publicId, owner: userId },
      tx,
    );
    const chatId = result.insertId;

    await execute(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES (:chatId, :me, 'member'), (:chatId, :other, 'member')`,
      { chatId, me: userId, other: other.id },
      tx,
    );
  });

  return getChat(userId, publicId);
}

export interface SendResult {
  message: Message;
  /** True when this was a repeat of a send the server had already accepted. */
  duplicate: boolean;
  chatId: number;
  recipientIds: number[];
}

/**
 * Sends a message.
 *
 * The `clientId` makes a retry safe, and the guarantee is in the database:
 * `uq_messages_sender_client` means a second insert with the same key cannot
 * succeed however the request arrived. Redis is only a fast path that saves the
 * round trip — with it down the unique key still holds, which is the whole
 * point, because a cache must never be what stands between a dropped
 * connection and a double-posted message (ADR-020).
 */
export async function sendMessage(
  userId: number,
  chatPublicId: string,
  input: SendMessageBody,
): Promise<SendResult> {
  const membership = await requireMembership(userId, chatPublicId);

  // A private chat can turn hostile after it is created — someone blocks the
  // other, or tightens who may message them — so this is checked per send, not
  // only when the chat is opened.
  const others = await query<{ user_id: number }>(
    `SELECT user_id FROM chat_participants
      WHERE chat_id = :chatId AND user_id <> :userId AND left_at IS NULL`,
    { chatId: membership.chatId, userId },
  );

  if (membership.kind === 'private') {
    const other = others[0];
    if (other) await assertCanMessage(userId, other.user_id);
  }

  if (membership.kind === 'community') {
    await assertCommunityCanPost(membership.chatId, userId);
  }

  const idemKey = `chat:send:${userId}:${input.clientId}`;
  const recipientIds = others.map((o) => o.user_id);

  const alreadySent = async (): Promise<SendResult | null> => {
    const cached = await cache.get(idemKey);
    const publicId =
      cached ??
      (
        await queryOne<{ public_id: string }>(
          `SELECT public_id FROM messages
            WHERE sender_id = :userId AND client_id = :clientId AND deleted_at IS NULL`,
          { userId, clientId: input.clientId },
        )
      )?.public_id;

    if (!publicId) return null;
    const existing = await messageByPublicId(publicId, userId);
    if (!existing) return null;

    return { message: existing, duplicate: true, chatId: membership.chatId, recipientIds };
  };

  const seenBefore = await alreadySent();
  if (seenBefore) return seenBefore;

  const replyToId = input.replyToId
    ? await resolveMessageId(membership.chatId, input.replyToId)
    : null;
  const sharedVideoId = input.sharedVideoId
    ? await resolveVideoId(input.sharedVideoId)
    : null;

  const publicId = ulid();

  try {
    await writeMessage();
  } catch (err) {
    // Two retries can arrive at once; the second loses the unique key. That is
    // the constraint doing its job, so the original message is returned rather
    // than an error the client cannot act on.
    if (isDuplicateKey(err)) {
      const existing = await alreadySent();
      if (existing) return existing;
    }
    throw err;
  }

  // Recorded after the write, so a crash mid-send leaves no key claiming a
  // message that does not exist.
  await cache.set(idemKey, publicId, 600);

  const message = await messageByPublicId(publicId, userId);
  if (!message) throw new AppError('internal_error', 'The message could not be read back.');

  return { message, duplicate: false, chatId: membership.chatId, recipientIds };

  async function writeMessage(): Promise<void> {
  await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO messages
         (public_id, client_id, chat_id, sender_id, kind, body, media_key, file_name, file_size,
          duration_sec, reply_to_id, shared_video_id)
       VALUES (:publicId, :clientId, :chatId, :senderId, :kind, :body, :mediaKey, :fileName,
               :fileSize, :durationSec, :replyToId, :sharedVideoId)`,
      {
        publicId,
        clientId: input.clientId,
        chatId: membership.chatId,
        senderId: userId,
        kind: input.kind,
        body: input.body ?? null,
        mediaKey: input.mediaKey ?? null,
        fileName: input.fileName ?? null,
        fileSize: input.fileSize ?? null,
        durationSec: input.durationSec ?? null,
        replyToId,
        sharedVideoId,
      },
      tx,
    );

    const messageId = result.insertId;

    // The sender has by definition seen their own message; a receipt row for
    // them would make every message look "read" the moment it was sent.
    if (others.length > 0) {
      await execute(
        `INSERT INTO message_receipts (message_id, user_id)
         VALUES ${others.map(() => '(?, ?)').join(', ')}`,
        others.flatMap((o) => [messageId, o.user_id]),
        tx,
      );
    }

    await execute(
      'UPDATE chats SET last_message_at = CURRENT_TIMESTAMP(3) WHERE id = :chatId',
      { chatId: membership.chatId },
      tx,
    );

    await execute(
      `UPDATE chat_participants
          SET unread_count = unread_count + 1
        WHERE chat_id = :chatId AND user_id <> :userId AND left_at IS NULL`,
      { chatId: membership.chatId, userId },
      tx,
    );
  });
  }
}

/** MySQL reports a unique-key collision as ER_DUP_ENTRY. */
function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

async function resolveMessageId(chatId: number, publicId: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    'SELECT id FROM messages WHERE public_id = :publicId AND chat_id = :chatId AND deleted_at IS NULL',
    { publicId, chatId },
  );
  // A reply pointing outside this conversation is dropped rather than rejected:
  // the message is still worth delivering, and the alternative is losing it.
  if (!row) return null;
  return row.id;
}

async function resolveVideoId(publicId: string): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM videos
      WHERE public_id = :publicId AND deleted_at IS NULL
        AND status = 'published' AND privacy = 'public'`,
    { publicId },
  );
  if (!row) throw new AppError('not_found', 'That video cannot be shared.');
  return row.id;
}

export async function messageByPublicId(
  publicId: string,
  viewerId: number,
): Promise<Message | null> {
  const row = await queryOne<MessageRow & { sender_id: number }>(
    `SELECT m.id, m.public_id, m.sender_id, m.kind, m.body, m.media_key, m.file_name,
            m.file_size, m.duration_sec, m.deleted_for_all_at, m.created_at,
            c.public_id AS chat_public_id,
            su.public_id AS sender_public_id,
            rm.public_id AS reply_to_public_id,
            rm.body AS reply_to_body,
            rp.display_name AS reply_to_sender,
            sv.public_id AS shared_video_public_id,
            (SELECT COUNT(*) FROM message_receipts r
              WHERE r.message_id = m.id AND r.user_id <> m.sender_id
                AND r.delivered_at IS NOT NULL) AS delivered_count,
            (SELECT COUNT(*) FROM message_receipts r
              WHERE r.message_id = m.id AND r.user_id <> m.sender_id
                AND r.seen_at IS NOT NULL) AS seen_count
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN users su ON su.id = m.sender_id
       LEFT JOIN messages rm ON rm.id = m.reply_to_id
       LEFT JOIN user_profiles rp ON rp.user_id = rm.sender_id
       LEFT JOIN videos sv ON sv.id = m.shared_video_id
      WHERE m.public_id = :publicId AND m.deleted_at IS NULL`,
    { publicId },
  );
  if (!row) return null;
  return toMessage(row, row.sender_id === viewerId);
}

/**
 * Marks everything up to a message as read, and clears the unread badge.
 *
 * Read receipts are written for the caller only. `seen_at` is set once and not
 * moved — the first time someone read a message is the fact worth keeping.
 */
export async function markRead(
  userId: number,
  chatPublicId: string,
  upToMessagePublicId?: string,
): Promise<{ read: number; unreadCount: number }> {
  const membership = await requireMembership(userId, chatPublicId);

  let upToId: number | null = null;
  if (upToMessagePublicId) {
    const row = await queryOne<{ id: number }>(
      'SELECT id FROM messages WHERE public_id = :publicId AND chat_id = :chatId',
      { publicId: upToMessagePublicId, chatId: membership.chatId },
    );
    upToId = row?.id ?? null;
  }

  const result = await execute(
    `UPDATE message_receipts r
       JOIN messages m ON m.id = r.message_id
        SET r.seen_at = CURRENT_TIMESTAMP(3),
            r.delivered_at = COALESCE(r.delivered_at, CURRENT_TIMESTAMP(3))
      WHERE r.user_id = :userId
        AND m.chat_id = :chatId
        AND r.seen_at IS NULL
        ${upToId !== null ? 'AND m.id <= :upToId' : ''}`,
    {
      userId,
      chatId: membership.chatId,
      ...(upToId !== null ? { upToId } : {}),
    },
  );

  await execute(
    `UPDATE chat_participants
        SET unread_count = 0,
            last_read_message_id = COALESCE(:upToId, last_read_message_id)
      WHERE chat_id = :chatId AND user_id = :userId`,
    { chatId: membership.chatId, userId, upToId },
  );

  return { read: result.affectedRows, unreadCount: 0 };
}

/** Marks messages delivered — the second tick. Called when a device receives them. */
export async function markDelivered(userId: number, messagePublicIds: string[]): Promise<number> {
  if (messagePublicIds.length === 0) return 0;

  const result = await execute(
    `UPDATE message_receipts r
       JOIN messages m ON m.id = r.message_id
        SET r.delivered_at = CURRENT_TIMESTAMP(3)
      WHERE r.user_id = :userId
        AND r.delivered_at IS NULL
        AND m.public_id IN (${messagePublicIds.map(() => '?').join(',')})`,
    [userId, ...messagePublicIds],
  );
  return result.affectedRows;
}

/**
 * Withdraws a message.
 *
 * "For me" hides it from one person; "for everyone" replaces its content for
 * all of them. Only the sender may do the latter, and only they may — a group
 * admin deleting someone else's words is moderation, which goes through the
 * report queue rather than through this.
 */
export async function deleteMessage(
  userId: number,
  messagePublicId: string,
  forEveryone: boolean,
): Promise<{ deleted: true; forEveryone: boolean; chatId: string }> {
  const row = await queryOne<{
    id: number;
    chat_id: number;
    sender_id: number;
    chat_public_id: string;
  }>(
    `SELECT m.id, m.chat_id, m.sender_id, c.public_id AS chat_public_id
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
      WHERE m.public_id = :publicId AND m.deleted_at IS NULL`,
    { publicId: messagePublicId },
  );
  if (!row) throw new AppError('not_found', 'Message not found.');

  // Membership is still required to delete for yourself.
  await requireMembership(userId, row.chat_public_id);

  if (forEveryone) {
    if (row.sender_id !== userId) {
      throw new AppError('forbidden', 'Only the sender can delete a message for everyone.');
    }
    await execute(
      'UPDATE messages SET deleted_for_all_at = CURRENT_TIMESTAMP(3) WHERE id = :id',
      { id: row.id },
    );
  } else {
    // Hiding it for one person is a receipt-level fact, so the row survives for
    // everybody else.
    await execute(
      `INSERT INTO message_receipts (message_id, user_id, hidden_at)
       VALUES (:messageId, :userId, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE hidden_at = CURRENT_TIMESTAMP(3)`,
      { messageId: row.id, userId },
    );
  }

  return { deleted: true, forEveryone, chatId: row.chat_public_id };
}

/** Mutes or unmutes a conversation for the caller only. */
export async function setMuted(
  userId: number,
  chatPublicId: string,
  muted: boolean,
): Promise<{ isMuted: boolean }> {
  const membership = await requireMembership(userId, chatPublicId);
  await execute(
    'UPDATE chat_participants SET is_muted = :muted WHERE chat_id = :chatId AND user_id = :userId',
    { muted: muted ? 1 : 0, chatId: membership.chatId, userId },
  );
  return { isMuted: muted };
}

// ── Groups ──

export async function createGroup(
  userId: number,
  input: { title: string; description?: string; memberIds: string[] },
): Promise<Chat> {
  const members = await query<{ id: number; public_id: string }>(
    `SELECT id, public_id FROM users
      WHERE public_id IN (${input.memberIds.map(() => '?').join(',') || 'NULL'})
        AND deleted_at IS NULL AND status <> 'banned'`,
    input.memberIds,
  );

  // Anyone who has blocked the creator, or been blocked by them, is left out
  // rather than the whole request failing — one bad name should not stop a
  // group from being made.
  const allowed: number[] = [];
  for (const member of members) {
    if (member.id === userId) continue;
    if (await social.isBlockedEitherWay(userId, member.id)) continue;
    allowed.push(member.id);
  }

  const publicId = ulid();
  await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO chats (public_id, kind, title, description, owner_id, member_count)
       VALUES (:publicId, 'group', :title, :description, :owner, :count)`,
      {
        publicId,
        title: input.title,
        description: input.description ?? null,
        owner: userId,
        count: allowed.length + 1,
      },
      tx,
    );
    const chatId = result.insertId;

    const rows: [number, number, string][] = [
      [chatId, userId, 'owner'],
      ...allowed.map((id): [number, number, string] => [chatId, id, 'member']),
    ];

    await execute(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`,
      rows.flat(),
      tx,
    );
  });

  return getChat(userId, publicId);
}

export async function updateGroup(
  userId: number,
  chatPublicId: string,
  patch: { title?: string; description?: string; avatarKey?: string },
): Promise<Chat> {
  const membership = await requireMembership(userId, chatPublicId);
  if (membership.kind === 'private') {
    throw new AppError('bad_request', 'A private conversation has no group settings.');
  }
  assertStaff(membership);

  const sets: string[] = [];
  const params: Record<string, unknown> = { chatId: membership.chatId };

  if (patch.title !== undefined) {
    sets.push('title = :title');
    params.title = patch.title;
  }
  if (patch.description !== undefined) {
    sets.push('description = :description');
    params.description = patch.description;
  }
  if (patch.avatarKey !== undefined) {
    sets.push('avatar_url = :avatar');
    params.avatar = storage.url(patch.avatarKey);
  }
  if (sets.length > 0) {
    await execute(`UPDATE chats SET ${sets.join(', ')} WHERE id = :chatId`, params);
  }

  return getChat(userId, chatPublicId);
}

export async function addMembers(
  userId: number,
  chatPublicId: string,
  memberPublicIds: string[],
): Promise<{ added: number }> {
  const membership = await requireMembership(userId, chatPublicId);
  if (membership.kind === 'private') {
    throw new AppError('bad_request', 'A private conversation cannot take more people.');
  }
  assertStaff(membership);

  const members = await query<{ id: number }>(
    `SELECT id FROM users
      WHERE public_id IN (${memberPublicIds.map(() => '?').join(',') || 'NULL'})
        AND deleted_at IS NULL AND status <> 'banned'`,
    memberPublicIds,
  );

  let added = 0;
  for (const member of members) {
    if (await social.isBlockedEitherWay(userId, member.id)) continue;
    // `left_at = NULL` lets someone who left be re-added without a second row,
    // and keeps their original join date so history stays hidden from them
    // exactly as before.
    const result = await execute(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES (:chatId, :userId, 'member')
       ON DUPLICATE KEY UPDATE left_at = NULL`,
      { chatId: membership.chatId, userId: member.id },
    );
    if (result.affectedRows > 0) added += 1;
  }

  await refreshMemberCount(membership.chatId);
  return { added };
}

export async function removeMember(
  userId: number,
  chatPublicId: string,
  memberPublicId: string,
): Promise<{ removed: true }> {
  const membership = await requireMembership(userId, chatPublicId);

  const member = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE public_id = :publicId',
    { publicId: memberPublicId },
  );
  if (!member) throw new AppError('not_found', 'Account not found.');

  // Leaving is always allowed; removing someone else is a staff action.
  const leavingSelf = member.id === userId;
  if (!leavingSelf) assertStaff(membership);

  const target = await queryOne<{ role: ChatRole }>(
    'SELECT role FROM chat_participants WHERE chat_id = :chatId AND user_id = :userId',
    { chatId: membership.chatId, userId: member.id },
  );
  if (!target) throw new AppError('not_found', 'That person is not in this conversation.');

  if (target.role === 'owner' && !leavingSelf) {
    throw new AppError('forbidden', 'The owner cannot be removed.');
  }

  await execute(
    `UPDATE chat_participants SET left_at = CURRENT_TIMESTAMP(3)
      WHERE chat_id = :chatId AND user_id = :userId`,
    { chatId: membership.chatId, userId: member.id },
  );

  await refreshMemberCount(membership.chatId);
  return { removed: true };
}

/** Counts are derived, so they cannot drift away from the rows. */
async function refreshMemberCount(chatId: number): Promise<void> {
  await execute(
    `UPDATE chats
        SET member_count = (SELECT COUNT(*) FROM chat_participants
                             WHERE chat_id = :chatId AND left_at IS NULL)
      WHERE id = :chatId`,
    { chatId },
  );
}

/** Community posting rules live on the community row, not the chat row. */
async function assertCommunityCanPost(chatId: number, userId: number): Promise<void> {
  const row = await queryOne<{ can_post: number; is_banned: number; is_muted: number; role: string }>(
    `SELECT co.can_post, cm.is_banned, cm.is_muted, cm.role
       FROM communities co
       LEFT JOIN community_members cm
              ON cm.community_id = co.id AND cm.user_id = :userId AND cm.left_at IS NULL
      WHERE co.chat_id = :chatId AND co.deleted_at IS NULL`,
    { chatId, userId },
  );
  if (!row) return;

  if (Number(row.is_banned) === 1) {
    throw new AppError('forbidden', 'You have been removed from this community.');
  }
  if (Number(row.is_muted) === 1) {
    throw new AppError('forbidden', 'You are muted in this community.');
  }
  // Staff can always post; `can_post` is the setting for ordinary members.
  const isStaff = row.role !== null && row.role !== 'member';
  if (Number(row.can_post) === 0 && !isStaff) {
    throw new AppError('forbidden', 'Only community staff can post here.');
  }
}

/** Everyone in a chat except the sender, for socket fan-out. */
export async function recipientsOf(chatId: number, exceptUserId: number): Promise<number[]> {
  const rows = await query<{ user_id: number }>(
    `SELECT user_id FROM chat_participants
      WHERE chat_id = :chatId AND user_id <> :userId AND left_at IS NULL`,
    { chatId, userId: exceptUserId },
  );
  return rows.map((r) => r.user_id);
}

/** Chat ids the user belongs to — used to join socket rooms on connect. */
export async function chatRoomsFor(userId: number): Promise<string[]> {
  try {
    const rows = await query<{ public_id: string }>(
      `SELECT c.public_id
         FROM chats c
         JOIN chat_participants p ON p.chat_id = c.id AND p.user_id = :userId
        WHERE c.deleted_at IS NULL AND p.left_at IS NULL`,
      { userId },
    );
    return rows.map((r) => r.public_id);
  } catch (err) {
    logger.warn({ err, userId }, 'could not load chat rooms');
    return [];
  }
}

/**
 * Voice and video calls.
 *
 * The server is a signalling relay and a bookkeeper, not a media path. SDP
 * offers, answers and ICE candidates are passed between peers **unread** — the
 * server never parses them, so it never becomes a place where call content
 * could be inspected. Media goes peer-to-peer (or through a TURN relay the
 * client is configured with), and this module knows only who called whom, when,
 * and how it ended.
 *
 * The privacy rule this enforces: **a call is offered before any device opens a
 * microphone or camera.** `startCall` creates a ringing record and notifies the
 * callee; nothing about capture happens until they accept. That is why `answer`
 * is a separate call rather than something inferred from the first ICE
 * candidate arriving.
 */

import { ulid } from 'ulid';
import { query, queryOne, execute, transaction } from '../../core/db.ts';
import { AppError } from '../../core/errors.ts';
import * as chat from './chat.service.ts';
import type { CallKind, CallRecord, CallState } from '../../../../shared/contracts/messaging.ts';
import type { PublicUser } from '../../../../shared/contracts/user.ts';

/** A call nobody answers is missed, not left ringing for ever. */
export const RING_TIMEOUT_SECONDS = 45;

interface CallRow {
  id: number;
  public_id: string;
  chat_public_id: string;
  initiator_public_id: string;
  initiator_id: number;
  kind: CallKind;
  is_group: number;
  status: CallState;
  started_at: Date | null;
  ended_at: Date | null;
  duration_sec: number | null;
  created_at: Date;
}

const CALL_SELECT = `
  SELECT c.id, c.public_id, c.kind, c.is_group, c.status, c.started_at, c.ended_at,
         c.duration_sec, c.created_at, c.initiator_id,
         ch.public_id AS chat_public_id,
         iu.public_id AS initiator_public_id
    FROM calls c
    JOIN chats ch ON ch.id = c.chat_id
    JOIN users iu ON iu.id = c.initiator_id
   WHERE c.deleted_at IS NULL
`;

async function peersOf(callIds: number[]): Promise<Map<number, PublicUser[]>> {
  const map = new Map<number, PublicUser[]>();
  if (callIds.length === 0) return map;

  const rows = await query<{
    call_id: number;
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
  }>(
    `SELECT cp.call_id, u.public_id, u.username, u.verification_tier,
            u.account_category, u.account_type, u.created_at,
            p.display_name, p.avatar_url, p.bio, p.follower_count, p.following_count,
            p.like_count, p.video_count, p.is_private
       FROM call_participants cp
       JOIN users u ON u.id = cp.user_id
       JOIN user_profiles p ON p.user_id = cp.user_id
      WHERE cp.call_id IN (${callIds.map(() => '?').join(',')})`,
    callIds,
  );

  for (const r of rows) {
    const user: PublicUser = {
      id: r.public_id,
      username: r.username,
      displayName: r.display_name,
      bio: r.bio ?? '',
      verified: r.verification_tier !== 'none',
      verificationTier: r.verification_tier as PublicUser['verificationTier'],
      accountCategory: r.account_category as PublicUser['accountCategory'],
      accountType: r.account_type as PublicUser['accountType'],
      followers: Number(r.follower_count),
      following: Number(r.following_count),
      likes: Number(r.like_count),
      videos: Number(r.video_count),
      isPrivate: r.is_private === 1,
      createdAt: new Date(r.created_at).toISOString(),
    };
    if (r.avatar_url) user.avatar = r.avatar_url;

    const list = map.get(r.call_id) ?? [];
    list.push(user);
    map.set(r.call_id, list);
  }
  return map;
}

function toCall(row: CallRow, peers: PublicUser[], viewerId: number): CallRecord {
  const record: CallRecord = {
    id: row.public_id,
    chatId: row.chat_public_id,
    kind: row.kind,
    isGroup: row.is_group === 1,
    initiatorId: row.initiator_public_id,
    peers,
    state: row.status,
    outgoing: row.initiator_id === viewerId,
    durationSec: Number(row.duration_sec ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
  };
  if (row.started_at) record.startedAt = new Date(row.started_at).toISOString();
  if (row.ended_at) record.endedAt = new Date(row.ended_at).toISOString();
  return record;
}

async function loadCall(publicId: string, viewerId: number): Promise<CallRecord> {
  const row = await queryOne<CallRow>(`${CALL_SELECT} AND c.public_id = :publicId`, {
    publicId,
  });
  if (!row) throw new AppError('not_found', 'Call not found.');
  const peers = await peersOf([row.id]);
  return toCall(row, peers.get(row.id) ?? [], viewerId);
}

/**
 * A call the caller is entitled to act on.
 *
 * Being a participant is the whole check. A call id from someone else's history
 * must not let a third party end their conversation.
 */
async function requireParticipant(
  publicId: string,
  userId: number,
): Promise<{ id: number; chat_id: number; status: CallState; initiator_id: number }> {
  const row = await queryOne<{
    id: number;
    chat_id: number;
    status: CallState;
    initiator_id: number;
  }>(
    `SELECT c.id, c.chat_id, c.status, c.initiator_id
       FROM calls c
       JOIN call_participants cp ON cp.call_id = c.id AND cp.user_id = :userId
      WHERE c.public_id = :publicId AND c.deleted_at IS NULL`,
    { publicId, userId },
  );
  if (!row) throw new AppError('not_found', 'Call not found.');
  return row;
}

export interface StartedCall {
  call: CallRecord;
  /** Everyone to ring. */
  calleeIds: number[];
}

/**
 * Places a call.
 *
 * The same membership, block and `whoCanMessage` rules as a message: someone who
 * cannot be messaged cannot be rung either. A call is a more intrusive contact
 * than a message, so anything short of that would make the messaging rules
 * bypassable by dialling instead of typing.
 */
export async function startCall(
  userId: number,
  chatPublicId: string,
  kind: CallKind,
): Promise<StartedCall> {
  const membership = await chat.requireMembership(userId, chatPublicId);

  const others = await chat.recipientsOf(membership.chatId, userId);
  if (others.length === 0) {
    throw new AppError('bad_request', 'There is nobody to call.');
  }

  if (membership.kind === 'private') {
    const other = others[0];
    if (other !== undefined) await chat.assertCanMessage(userId, other);
  }

  // One live call per conversation. A second would split the participants
  // between two sessions that cannot hear each other.
  const existing = await queryOne<{ public_id: string }>(
    `SELECT public_id FROM calls
      WHERE chat_id = :chatId AND status IN ('ringing', 'active') AND deleted_at IS NULL
      LIMIT 1`,
    { chatId: membership.chatId },
  );
  if (existing) {
    return { call: await loadCall(existing.public_id, userId), calleeIds: others };
  }

  const publicId = ulid();
  await transaction(async (tx) => {
    const result = await execute(
      `INSERT INTO calls (public_id, chat_id, initiator_id, kind, is_group, status)
       VALUES (:publicId, :chatId, :initiator, :kind, :isGroup, 'ringing')`,
      {
        publicId,
        chatId: membership.chatId,
        initiator: userId,
        kind,
        isGroup: membership.kind === 'private' ? 0 : 1,
      },
      tx,
    );
    const callId = result.insertId;

    // The initiator has joined by definition; everyone else is pending until
    // they answer, which is what keeps their microphone closed until then.
    const rows: [number, number, string][] = [
      [callId, userId, 'joined'],
      ...others.map((id): [number, number, string] => [callId, id, 'missed']),
    ];

    await execute(
      `INSERT INTO call_participants (call_id, user_id, outcome)
       VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`,
      rows.flat(),
      tx,
    );

    await execute(
      'UPDATE call_participants SET joined_at = CURRENT_TIMESTAMP(3) WHERE call_id = :callId AND user_id = :userId',
      { callId, userId },
      tx,
    );
  });

  return { call: await loadCall(publicId, userId), calleeIds: others };
}

export async function answerCall(userId: number, publicId: string): Promise<CallRecord> {
  const row = await requireParticipant(publicId, userId);

  if (row.status === 'ended' || row.status === 'declined') {
    throw new AppError('bad_request', 'That call has already finished.');
  }
  if (row.initiator_id === userId) {
    throw new AppError('bad_request', 'You placed this call.');
  }

  await transaction(async (tx) => {
    // `started_at` is set once, by whoever answers first — a group call's
    // duration runs from the first connection, not from each person joining.
    await execute(
      `UPDATE calls
          SET status = 'active', started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3))
        WHERE id = :id`,
      { id: row.id },
      tx,
    );
    await execute(
      `UPDATE call_participants
          SET outcome = 'joined', joined_at = CURRENT_TIMESTAMP(3)
        WHERE call_id = :callId AND user_id = :userId`,
      { callId: row.id, userId },
      tx,
    );
  });

  return loadCall(publicId, userId);
}

export async function declineCall(userId: number, publicId: string): Promise<CallRecord> {
  const row = await requireParticipant(publicId, userId);

  await execute(
    `UPDATE call_participants SET outcome = 'declined', left_at = CURRENT_TIMESTAMP(3)
      WHERE call_id = :callId AND user_id = :userId`,
    { callId: row.id, userId },
  );

  // A one-to-one call is over when the callee declines. In a group, the others
  // may still be ringing, so the call continues without them.
  const remaining = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM call_participants
      WHERE call_id = :callId AND outcome <> 'declined' AND user_id <> :initiator`,
    { callId: row.id, initiator: row.initiator_id },
  );

  if (Number(remaining?.c ?? 0) === 0) {
    await execute(
      `UPDATE calls SET status = 'declined', ended_at = CURRENT_TIMESTAMP(3) WHERE id = :id`,
      { id: row.id },
    );
  }

  return loadCall(publicId, userId);
}

export async function endCall(userId: number, publicId: string): Promise<CallRecord> {
  const row = await requireParticipant(publicId, userId);

  await execute(
    `UPDATE call_participants SET left_at = CURRENT_TIMESTAMP(3)
      WHERE call_id = :callId AND user_id = :userId AND left_at IS NULL`,
    { callId: row.id, userId },
  );

  const stillOn = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM call_participants
      WHERE call_id = :callId AND outcome = 'joined' AND left_at IS NULL`,
    { callId: row.id },
  );

  if (Number(stillOn?.c ?? 0) <= 1) {
    // A call that never connected is missed, not ended: the difference is what
    // the callee's history should show.
    await execute(
      `UPDATE calls
          SET status = CASE WHEN started_at IS NULL THEN 'missed' ELSE 'ended' END,
              ended_at = CURRENT_TIMESTAMP(3),
              duration_sec = CASE
                WHEN started_at IS NULL THEN 0
                ELSE TIMESTAMPDIFF(SECOND, started_at, CURRENT_TIMESTAMP(3))
              END
        WHERE id = :id AND status IN ('ringing', 'active')`,
      { id: row.id },
    );
  }

  return loadCall(publicId, userId);
}

export async function setCallState(
  userId: number,
  publicId: string,
  patch: { isMuted?: boolean; cameraOn?: boolean },
): Promise<{ isMuted: boolean; cameraOn: boolean }> {
  const row = await requireParticipant(publicId, userId);

  const sets: string[] = [];
  const params: Record<string, unknown> = { callId: row.id, userId };
  if (patch.isMuted !== undefined) {
    sets.push('is_muted = :isMuted');
    params.isMuted = patch.isMuted ? 1 : 0;
  }
  if (patch.cameraOn !== undefined) {
    sets.push('camera_on = :cameraOn');
    params.cameraOn = patch.cameraOn ? 1 : 0;
  }
  if (sets.length > 0) {
    await execute(
      `UPDATE call_participants SET ${sets.join(', ')}
        WHERE call_id = :callId AND user_id = :userId`,
      params,
    );
  }

  const after = await queryOne<{ is_muted: number; camera_on: number }>(
    'SELECT is_muted, camera_on FROM call_participants WHERE call_id = :callId AND user_id = :userId',
    { callId: row.id, userId },
  );

  return {
    isMuted: Number(after?.is_muted ?? 0) === 1,
    cameraOn: Number(after?.camera_on ?? 1) === 1,
  };
}

/** The other people on a call, for relaying signals to. */
export async function otherParticipants(publicId: string, userId: number): Promise<number[]> {
  const row = await requireParticipant(publicId, userId);
  const rows = await query<{ user_id: number }>(
    'SELECT user_id FROM call_participants WHERE call_id = :callId AND user_id <> :userId',
    { callId: row.id, userId },
  );
  return rows.map((r) => r.user_id);
}

export async function listCalls(userId: number, limit = 50): Promise<CallRecord[]> {
  const rows = await query<CallRow>(
    `${CALL_SELECT}
       AND EXISTS(SELECT 1 FROM call_participants cp
                   WHERE cp.call_id = c.id AND cp.user_id = :userId)
     ORDER BY c.created_at DESC
     LIMIT :limit`,
    { userId, limit },
  );

  const peers = await peersOf(rows.map((r) => r.id));
  return rows.map((row) => toCall(row, peers.get(row.id) ?? [], userId));
}

/**
 * Marks calls nobody answered as missed.
 *
 * Without this a ringing call stays ringing for ever, and `startCall` would then
 * refuse to place a new one because it thinks a call is already live. Called on
 * every start, so no scheduler is needed for it to be correct.
 */
export async function expireStaleRinging(): Promise<number> {
  const result = await execute(
    `UPDATE calls
        SET status = 'missed', ended_at = CURRENT_TIMESTAMP(3), duration_sec = 0
      WHERE status = 'ringing'
        AND created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :seconds SECOND)`,
    { seconds: RING_TIMEOUT_SECONDS },
  );
  return result.affectedRows;
}

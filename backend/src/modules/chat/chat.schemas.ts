/** Request shapes for chat, groups and calls. */

import { z } from 'zod';

export const messageKindSchema = z.enum([
  'text',
  'image',
  'video',
  'document',
  'voice',
  'shared_video',
]);

/**
 * A message must carry something.
 *
 * `text` needs a body; everything else needs a media key or a shared video.
 * Without this a client could post an endless run of empty rows that render as
 * blank bubbles and still count as unread.
 */
export const sendMessageSchema = z
  .object({
    kind: messageKindSchema,
    body: z.string().trim().max(4000).optional(),
    mediaKey: z.string().trim().max(500).optional(),
    fileName: z.string().trim().max(255).optional(),
    fileSize: z.coerce.number().int().nonnegative().max(500 * 1024 * 1024).optional(),
    durationSec: z.coerce.number().int().nonnegative().max(3600).optional(),
    replyToId: z.string().trim().max(64).optional(),
    sharedVideoId: z.string().trim().max(64).optional(),
    clientId: z.string().trim().min(8).max(64),
  })
  .refine(
    (v) =>
      v.kind === 'text'
        ? (v.body?.length ?? 0) > 0
        : v.kind === 'shared_video'
          ? Boolean(v.sharedVideoId)
          : Boolean(v.mediaKey),
    { message: 'This message has no content.' },
  )
  .refine((v) => v.kind !== 'voice' || (v.durationSec ?? 0) > 0, {
    message: 'A voice note needs a duration.',
  });

export const chatPageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const openDirectSchema = z.object({
  userId: z.string().trim().min(1).max(64),
});

export const createGroupSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  memberIds: z.array(z.string().trim().min(1).max(64)).max(256).default([]),
});

export const updateGroupSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  avatarKey: z.string().trim().max(500).optional(),
});

export const addMembersSchema = z.object({
  memberIds: z.array(z.string().trim().min(1).max(64)).min(1).max(64),
});

export const markReadSchema = z.object({
  upToMessageId: z.string().trim().max(64).optional(),
});

export const deliveredSchema = z.object({
  messageIds: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
});

export const deleteMessageSchema = z.object({
  forEveryone: z.coerce.boolean().optional(),
});

export const muteSchema = z.object({
  muted: z.boolean(),
});

// ── Communities ──

export const createCommunitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
  isPrivate: z.boolean().default(false),
  rules: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});

export const updateCommunitySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  announcement: z.string().trim().max(1000).optional(),
  rules: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  isPrivate: z.boolean().optional(),
  logoKey: z.string().trim().max(500).optional(),
  bannerKey: z.string().trim().max(500).optional(),
  canPost: z.boolean().optional(),
  canComment: z.boolean().optional(),
  canSendMedia: z.boolean().optional(),
  canSendLinks: z.boolean().optional(),
  canInvite: z.boolean().optional(),
});

export const joinCommunitySchema = z.object({
  message: z.string().trim().max(500).optional(),
});

export const memberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
});

export const memberModerationSchema = z.object({
  muted: z.boolean().optional(),
  banned: z.boolean().optional(),
});

export const decideRequestSchema = z.object({
  approve: z.boolean(),
});

// ── Calls ──

export const startCallSchema = z.object({
  chatId: z.string().trim().min(1).max(64),
  kind: z.enum(['voice', 'video']),
});

export const callSignalSchema = z.object({
  /** Opaque to the server: WebRTC SDP or an ICE candidate, relayed unread. */
  payload: z.unknown(),
  /** The peer this is meant for; absent means everyone else on the call. */
  toUserId: z.string().trim().max(64).optional(),
});

export const callStateSchema = z.object({
  isMuted: z.boolean().optional(),
  cameraOn: z.boolean().optional(),
});

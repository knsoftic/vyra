import {
  Comment,
  Chat,
  Message,
  Community,
  CallRecord,
  AppNotification,
  Group,
} from '../types';
import { users, currentUser } from './users';
import { videos } from './videos';
import { minutesAgo, hoursAgo, daysAgo } from '../utils/format';

// ─────────────────────────────── Comments ───────────────────────────────

export const comments: Comment[] = [
  {
    id: 'c_1',
    author: users[6],
    text: 'The part at 0:18 genuinely changed how I write this. Thank you.',
    createdAt: hoursAgo(2),
    likes: 4210,
    liked: true,
    replyCount: 12,
    isPinned: true,
    replies: [
      {
        id: 'c_1_r1',
        author: users[1],
        text: 'Glad it helped! Full breakdown is on my profile.',
        createdAt: hoursAgo(1),
        likes: 890,
        replyCount: 0,
        isCreator: true,
      },
    ],
  },
  {
    id: 'c_2',
    author: users[7],
    text: 'Been debugging this exact thing for two days. Unreal timing.',
    createdAt: hoursAgo(3),
    likes: 1820,
    replyCount: 3,
  },
  {
    id: 'c_3',
    author: users[9],
    text: 'Clean explanation. Most people overcomplicate it.',
    createdAt: hoursAgo(5),
    likes: 640,
    replyCount: 0,
  },
  {
    id: 'c_4',
    author: users[3],
    text: 'Can you do one on error handling next?',
    createdAt: hoursAgo(7),
    likes: 312,
    replyCount: 1,
  },
  {
    id: 'c_5',
    author: users[10],
    text: 'Saved. Watching this again tomorrow.',
    createdAt: hoursAgo(9),
    likes: 96,
    replyCount: 0,
  },
  {
    id: 'c_6',
    author: users[5],
    text: 'The editing on this is so smooth.',
    createdAt: hoursAgo(12),
    likes: 74,
    replyCount: 0,
  },
];

// ──────────────────────────────── Chats ─────────────────────────────────

const msg = (
  id: string,
  chatId: string,
  senderId: string,
  overrides: Partial<Message> = {},
): Message => ({
  id,
  chatId,
  senderId,
  kind: 'text',
  createdAt: minutesAgo(30),
  status: 'seen',
  ...overrides,
});

export const chats: Chat[] = [
  {
    id: 'ch_1',
    kind: 'private',
    title: users[1].displayName,
    avatar: users[1].avatar,
    participants: [currentUser, users[1]],
    unreadCount: 2,
    isOnline: true,
    isTyping: true,
    lastMessage: msg('m_l1', 'ch_1', users[1].id, {
      text: 'Sent you the draft — tell me what you think',
      createdAt: minutesAgo(4),
      status: 'delivered',
    }),
  },
  {
    id: 'ch_2',
    kind: 'private',
    title: users[6].displayName,
    avatar: users[6].avatar,
    participants: [currentUser, users[6]],
    unreadCount: 0,
    isOnline: false,
    lastSeen: hoursAgo(3),
    lastMessage: msg('m_l2', 'ch_2', currentUser.id, {
      text: 'Safe travels! Send photos',
      createdAt: hoursAgo(3),
      status: 'seen',
    }),
  },
  {
    id: 'ch_3',
    kind: 'group',
    title: 'Editor Beta Testers',
    avatar: 'https://picsum.photos/seed/group1/200/200',
    participants: [currentUser, users[1], users[7], users[4], users[9]],
    unreadCount: 14,
    lastMessage: msg('m_l3', 'ch_3', users[7].id, {
      text: 'The filter carousel is buttery now',
      createdAt: minutesAgo(22),
      status: 'delivered',
    }),
  },
  {
    id: 'ch_4',
    kind: 'private',
    title: users[4].displayName,
    avatar: users[4].avatar,
    participants: [currentUser, users[4]],
    unreadCount: 0,
    isOnline: true,
    lastMessage: msg('m_l4', 'ch_4', users[4].id, {
      kind: 'voice',
      durationSec: 34,
      createdAt: hoursAgo(6),
      status: 'seen',
    }),
  },
  {
    id: 'ch_5',
    kind: 'private',
    title: users[11].displayName,
    avatar: users[11].avatar,
    participants: [currentUser, users[11]],
    unreadCount: 1,
    isOnline: true,
    lastMessage: msg('m_l5', 'ch_5', users[11].id, {
      kind: 'shared_video',
      text: 'This is the one I was talking about',
      mediaUrl: videos[10].poster,
      createdAt: hoursAgo(8),
      status: 'delivered',
    }),
  },
  {
    id: 'ch_6',
    kind: 'group',
    title: 'Weekend Shoot Crew',
    avatar: 'https://picsum.photos/seed/group2/200/200',
    participants: [currentUser, users[2], users[5], users[10]],
    unreadCount: 0,
    isMuted: true,
    lastMessage: msg('m_l6', 'ch_6', users[2].id, {
      text: 'Call time is 6am, do not be late',
      createdAt: daysAgo(1),
      status: 'seen',
    }),
  },
  {
    id: 'ch_7',
    kind: 'private',
    title: users[9].displayName,
    avatar: users[9].avatar,
    participants: [currentUser, users[9]],
    unreadCount: 0,
    lastSeen: daysAgo(2),
    lastMessage: msg('m_l7', 'ch_7', currentUser.id, {
      text: 'Appreciate the feedback on the last one',
      createdAt: daysAgo(2),
      status: 'seen',
    }),
  },
];

export const messages: Record<string, Message[]> = {
  ch_1: [
    msg('m1', 'ch_1', users[1].id, { text: 'Hey! Are you around this week?', createdAt: hoursAgo(26) }),
    msg('m2', 'ch_1', currentUser.id, { text: 'Yeah, mostly. What is up?', createdAt: hoursAgo(25) }),
    msg('m3', 'ch_1', users[1].id, {
      text: 'Working on a collab video about the recommendation engine. Want in?',
      createdAt: hoursAgo(25),
    }),
    msg('m4', 'ch_1', currentUser.id, { text: 'Absolutely. That is exactly my thing', createdAt: hoursAgo(24) }),
    msg('m5', 'ch_1', users[1].id, {
      kind: 'image',
      mediaUrl: 'https://picsum.photos/seed/chatimg1/600/800',
      text: 'Storyboard so far',
      createdAt: hoursAgo(23),
    }),
    msg('m6', 'ch_1', currentUser.id, {
      text: 'This is clean. Maybe cut the third panel?',
      createdAt: hoursAgo(22),
      replyTo: { id: 'm5', senderName: 'Maya Chen', preview: 'Storyboard so far' },
    }),
    msg('m7', 'ch_1', users[1].id, { kind: 'voice', durationSec: 18, createdAt: hoursAgo(20) }),
    msg('m8', 'ch_1', users[1].id, {
      kind: 'document',
      fileName: 'collab-script-v3.pdf',
      fileSize: '842 KB',
      createdAt: minutesAgo(40),
    }),
    msg('m9', 'ch_1', users[1].id, {
      text: 'Sent you the draft — tell me what you think',
      createdAt: minutesAgo(4),
      status: 'delivered',
    }),
  ],
  ch_3: [
    msg('g1', 'ch_3', users[4].id, { text: 'New build is up for everyone', createdAt: hoursAgo(5) }),
    msg('g2', 'ch_3', users[9].id, { text: 'Trim handles feel much better', createdAt: hoursAgo(4) }),
    msg('g3', 'ch_3', users[1].id, {
      kind: 'video',
      mediaUrl: videos[4].poster,
      text: 'Recorded a bug repro',
      createdAt: hoursAgo(2),
    }),
    msg('g4', 'ch_3', currentUser.id, { text: 'Nice catch, logging it now', createdAt: hoursAgo(1) }),
    msg('g5', 'ch_3', users[7].id, {
      text: 'The filter carousel is buttery now',
      createdAt: minutesAgo(22),
      status: 'delivered',
    }),
  ],
};

export const groups: Group[] = [
  {
    ...(chats[2] as Group),
    kind: 'group',
    description: 'Closed testing group for the new video editor. Report bugs with a screen recording.',
    ownerId: users[4].id,
    adminIds: [users[4].id, users[1].id],
    memberCount: 5,
    pinnedMessageId: 'g1',
  },
];

// ────────────────────────────── Communities ─────────────────────────────

export const communities: Community[] = [
  {
    id: 'cm_1',
    name: 'Creators Who Code',
    logo: 'https://picsum.photos/seed/comm1/200/200',
    banner: 'https://picsum.photos/seed/commb1/800/400',
    description:
      'For creators who build software and make videos about it. Share work, ask questions, no self-promo spam.',
    rules: [
      'Be useful or be quiet',
      'No spam, no engagement bait',
      'Credit other people work',
      'Keep it safe for work',
    ],
    isPrivate: false,
    memberCount: 24800,
    myRole: 'member',
    permissions: {
      canPost: true,
      canComment: true,
      canSendMedia: true,
      canSendLinks: false,
      canInvite: true,
    },
    announcement: 'Community call this Friday at 18:00 UTC. Link pinned in chat.',
    unreadCount: 8,
    // No `members` array: ordinary members never receive the roster (ADR-014).
  },
  {
    id: 'cm_2',
    name: 'Garage Builds',
    logo: 'https://picsum.photos/seed/comm2/200/200',
    banner: 'https://picsum.photos/seed/commb2/800/400',
    description: 'Project cars, restorations, and honest build logs.',
    rules: ['No sale posts', 'Show the work, not just the result'],
    isPrivate: true,
    memberCount: 8420,
    myRole: 'owner',
    permissions: {
      canPost: true,
      canComment: true,
      canSendMedia: true,
      canSendLinks: true,
      canInvite: true,
    },
    pendingRequests: 23,
    // Owner view: the roster IS available.
    members: users.slice(1, 9),
    unreadCount: 0,
  },
  {
    id: 'cm_3',
    name: 'Street Food Hunters',
    logo: 'https://picsum.photos/seed/comm3/200/200',
    description: 'Find it, film it, share the location.',
    rules: ['Always tag the city', 'Be respectful to vendors'],
    isPrivate: false,
    memberCount: 61200,
    myRole: 'moderator',
    permissions: {
      canPost: true,
      canComment: true,
      canSendMedia: true,
      canSendLinks: true,
      canInvite: true,
    },
    pendingRequests: 7,
    members: users.slice(2, 7),
    unreadCount: 3,
  },
];

export const communityJoinRequests = [
  { id: 'jr_1', user: users[10], requestedAt: hoursAgo(3), message: 'Been restoring a 1994 hatchback.' },
  { id: 'jr_2', user: users[7], requestedAt: hoursAgo(9), message: 'Here to learn.' },
  { id: 'jr_3', user: users[5], requestedAt: daysAgo(1) },
  { id: 'jr_4', user: users[3], requestedAt: daysAgo(2), message: 'Friend of Ravi.' },
];

// ──────────────────────────────── Calls ─────────────────────────────────

export const callHistory: CallRecord[] = [
  {
    id: 'call_1',
    kind: 'video',
    direction: 'incoming',
    participants: [users[1]],
    isGroup: false,
    startedAt: hoursAgo(2),
    durationSec: 1284,
  },
  {
    id: 'call_2',
    kind: 'voice',
    direction: 'missed',
    participants: [users[4]],
    isGroup: false,
    startedAt: hoursAgo(7),
    durationSec: 0,
  },
  {
    id: 'call_3',
    kind: 'video',
    direction: 'outgoing',
    participants: [users[1], users[7], users[4]],
    isGroup: true,
    startedAt: daysAgo(1),
    durationSec: 3420,
  },
  {
    id: 'call_4',
    kind: 'voice',
    direction: 'outgoing',
    participants: [users[6]],
    isGroup: false,
    startedAt: daysAgo(2),
    durationSec: 642,
  },
  {
    id: 'call_5',
    kind: 'voice',
    direction: 'missed',
    participants: [users[9]],
    isGroup: false,
    startedAt: daysAgo(4),
    durationSec: 0,
  },
];

// ───────────────────────────── Notifications ────────────────────────────

export const notifications: AppNotification[] = [
  {
    id: 'n_1',
    kind: 'like',
    actor: users[6],
    text: 'liked your video',
    videoThumb: videos[11].poster,
    createdAt: minutesAgo(12),
    read: false,
  },
  {
    id: 'n_2',
    kind: 'comment',
    actor: users[1],
    text: 'commented: "This is the cleanest explanation I have seen"',
    videoThumb: videos[11].poster,
    createdAt: minutesAgo(48),
    read: false,
  },
  {
    id: 'n_3',
    kind: 'follow',
    actor: users[7],
    text: 'started following you',
    createdAt: hoursAgo(2),
    read: false,
  },
  {
    id: 'n_4',
    kind: 'gift',
    actor: users[5],
    text: 'sent you a Crown during your live',
    createdAt: hoursAgo(5),
    read: true,
  },
  {
    id: 'n_5',
    kind: 'mention',
    actor: users[2],
    text: 'mentioned you in a comment',
    videoThumb: videos[1].poster,
    createdAt: hoursAgo(9),
    read: true,
  },
  {
    id: 'n_6',
    kind: 'verification',
    text: 'Your creator verification was approved.',
    createdAt: daysAgo(1),
    read: true,
  },
  {
    id: 'n_7',
    kind: 'campaign',
    text: 'Your promotion "Editor launch" finished. 84,200 people reached.',
    createdAt: daysAgo(2),
    read: true,
  },
  {
    id: 'n_8',
    kind: 'system',
    text: 'New community guidelines take effect on 1 September.',
    createdAt: daysAgo(3),
    read: true,
  },
  {
    id: 'n_9',
    kind: 'like',
    actor: users[9],
    text: 'and 2,140 others liked your video',
    videoThumb: videos[11].poster,
    createdAt: daysAgo(4),
    read: true,
  },
];

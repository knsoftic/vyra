import { VerificationRequest, SupportTicket, ReportRecord } from '../types';
import { daysAgo, hoursAgo } from '../utils/format';

export const verificationRequest: VerificationRequest = {
  id: 'vr_1',
  tier: 'creator',
  status: 'approved',
  submittedAt: daysAgo(21),
  reviewedAt: daysAgo(18),
  note: 'Approved — consistent original content and verified identity document.',
};

export const verificationTiers = [
  {
    id: 'individual',
    label: 'Individual',
    description: 'For real people using their own name.',
    requirements: [
      'Government-issued photo ID',
      'Account active for at least 30 days',
      'Complete profile with a photo',
      'No community guideline strikes in 90 days',
    ],
  },
  {
    id: 'creator',
    label: 'Creator',
    description: 'For creators with an established audience.',
    requirements: [
      'Government-issued photo ID',
      'At least 10,000 followers',
      'At least 20 original videos in the last 90 days',
      'No community guideline strikes in 90 days',
    ],
  },
  {
    id: 'business',
    label: 'Business',
    description: 'For registered companies, brands and organizations.',
    requirements: [
      'Business registration document',
      'Official business email domain',
      'Website matching the business name',
      'Authorised representative confirmation',
    ],
  },
] as const;

export const supportTickets: SupportTicket[] = [
  {
    id: 'tk_1041',
    subject: 'Coins not credited after purchase',
    category: 'coins',
    status: 'in_progress',
    createdAt: hoursAgo(6),
    updatedAt: hoursAgo(2),
    messageCount: 4,
  },
  {
    id: 'tk_1038',
    subject: 'Video stuck on processing',
    category: 'video',
    status: 'waiting',
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
    messageCount: 3,
  },
  {
    id: 'tk_1029',
    subject: 'Business verification documents',
    category: 'verification',
    status: 'resolved',
    createdAt: daysAgo(11),
    updatedAt: daysAgo(9),
    messageCount: 7,
  },
  {
    id: 'tk_1012',
    subject: 'Campaign rejected without reason',
    category: 'advertisement',
    status: 'closed',
    createdAt: daysAgo(24),
    updatedAt: daysAgo(20),
    messageCount: 5,
  },
];

export const ticketCategories = [
  { id: 'account', label: 'Account Issue', icon: 'person-circle-outline' },
  { id: 'payment', label: 'Payment Issue', icon: 'card-outline' },
  { id: 'coins', label: 'Coin Issue', icon: 'logo-bitcoin' },
  { id: 'video', label: 'Video Issue', icon: 'videocam-outline' },
  { id: 'verification', label: 'Verification Issue', icon: 'checkmark-circle-outline' },
  { id: 'advertisement', label: 'Advertisement Issue', icon: 'megaphone-outline' },
  { id: 'technical', label: 'Technical Issue', icon: 'construct-outline' },
] as const;

export const myReports: ReportRecord[] = [
  {
    id: 'rp_1',
    targetType: 'comment',
    targetLabel: 'Comment by @spam.account.7741',
    reason: 'Spam',
    status: 'action_taken',
    createdAt: daysAgo(3),
  },
  {
    id: 'rp_2',
    targetType: 'video',
    targetLabel: 'Video "Get rich in 7 days"',
    reason: 'Misleading content',
    status: 'reviewing',
    createdAt: daysAgo(1),
  },
  {
    id: 'rp_3',
    targetType: 'user',
    targetLabel: '@harsh.troll',
    reason: 'Harassment',
    status: 'action_taken',
    createdAt: daysAgo(9),
  },
  {
    id: 'rp_4',
    targetType: 'live',
    targetLabel: 'Live by @unknown.host',
    reason: 'Dangerous behaviour',
    status: 'no_action',
    createdAt: daysAgo(16),
  },
];

export const reportReasons = [
  'Spam',
  'Harassment or bullying',
  'Hate speech',
  'Violence or dangerous behaviour',
  'Nudity or sexual content',
  'Misleading content',
  'Intellectual property violation',
  'Scam or fraud',
  'Self-harm',
  'Something else',
];

export const faqs = [
  {
    q: 'How does the For You feed decide what I see?',
    a: 'It combines what you watch, finish, rewatch, like, comment on, share and save with the creators you interact with most. You can push it away from anything by tapping "Not interested" or hiding a creator.',
  },
  {
    q: 'Why did my video get fewer views than usual?',
    a: 'Every video starts with a small test audience and grows only if people watch it. Distribution depends on watch time and completion, not on your follower count alone.',
  },
  {
    q: 'Are my drafts safe when the app updates?',
    a: 'Yes. Drafts are stored on your device and on our servers, and app updates never clear them.',
  },
  {
    q: 'What can I do with coins?',
    a: 'Send gifts during live streams and promote your videos. Every coin movement appears in your transaction history with a running balance.',
  },
  {
    q: 'How do I get verified?',
    a: 'Open Settings, then Verification, choose the badge type and submit the required documents. Reviews usually take 3 to 7 days.',
  },
  {
    q: 'Does the app listen to my microphone?',
    a: 'No. The microphone is used only when you record a video, send a voice note, join a call or go live, and always with your permission.',
  },
  {
    q: 'How do I stop someone contacting me?',
    a: 'Open their profile, tap the menu and choose Block. Blocking hides your content from them and stops all messages.',
  },
];

export const privacySettings = [
  {
    section: 'Account privacy',
    items: [
      { id: 'private_account', label: 'Private account', value: false, description: 'Only approved followers can see your videos' },
      { id: 'suggest_account', label: 'Suggest your account to others', value: true },
    ],
  },
  {
    section: 'Interactions',
    items: [
      { id: 'allow_comments', label: 'Allow comments', value: true },
      { id: 'allow_duet', label: 'Allow Duet', value: true },
      { id: 'allow_remix', label: 'Allow Remix', value: true },
      { id: 'allow_download', label: 'Allow downloads', value: false },
      { id: 'allow_messages', label: 'Allow direct messages', value: true },
      { id: 'allow_mentions', label: 'Allow mentions', value: true },
    ],
  },
  {
    section: 'Data',
    items: [
      { id: 'personalized_ads', label: 'Personalized ads', value: true, description: 'Uses your in-app activity only' },
      { id: 'activity_status', label: 'Show activity status', value: true },
      { id: 'location', label: 'Use location for Nearby', value: false, description: 'Off means Nearby stays empty' },
    ],
  },
];

export const notificationSettings = [
  {
    section: 'Interactions',
    items: [
      { id: 'likes', label: 'Likes', value: true },
      { id: 'comments', label: 'Comments', value: true },
      { id: 'new_followers', label: 'New followers', value: true },
      { id: 'mentions', label: 'Mentions and tags', value: true },
    ],
  },
  {
    section: 'Content',
    items: [
      { id: 'video_updates', label: 'Video processing updates', value: true },
      { id: 'live_from_following', label: 'Live from people you follow', value: true },
      { id: 'suggested', label: 'Suggested videos', value: false },
    ],
  },
  {
    section: 'Account',
    items: [
      { id: 'gifts', label: 'Gifts and coins', value: true },
      { id: 'campaigns', label: 'Campaign updates', value: true },
      { id: 'platform', label: 'Platform announcements', value: true },
    ],
  },
];

/** Mirrors Super Admin -> App Settings. Read-only in the app. */
export const appInfo = {
  appName: 'Vyra',
  version: '1.0.0',
  build: '100',
  minSupportedVersion: '1.0.0',
  privacyPolicyUrl: 'https://example.com/privacy',
  termsUrl: 'https://example.com/terms',
  guidelinesUrl: 'https://example.com/guidelines',
  maxVideoDurationSec: 600,
  maxFileSizeMb: 500,
  supportedFormats: ['mp4', 'mov', 'm4v'],
};

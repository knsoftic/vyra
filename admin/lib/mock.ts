/**
 * Admin mock data (Phase 1).
 *
 * Shapes mirror what the Phase 11 admin API will return, so pages swap data
 * sources without changing markup.
 */

const avatar = (n: number) => `https://i.pravatar.cc/80?img=${n}`;
const poster = (seed: string) => `https://picsum.photos/seed/${seed}/120/200`;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

export const fmt = {
  n: (value: number) => value.toLocaleString('en-US'),
  compact: (value: number) => {
    if (value < 1000) return String(value);
    if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
    if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  },
  money: (value: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value),
  ago: (iso: string) => {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return `${Math.floor(d / 30)}mo ago`;
  },
  date: (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
  datetime: (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
};

/* ─────────────────────────────── Dashboard ────────────────────────────── */

export const dashboardStats = {
  totalUsers: 4_182_400,
  activeUsers: 1_284_900,
  onlineUsers: 84_210,
  newUsers: 12_840,
  creators: 218_400,
  businesses: 14_920,
  verified: 8_412,
  totalVideos: 21_840_000,
  dailyUploads: 184_200,
  videoViews: 892_400_000,
  watchTimeHours: 4_120_000,
  liveStreams: 1_284,
  communities: 24_800,
  groups: 184_200,
  messages: 42_800_000,
  coinSales: 184_920,
  giftRevenue: 92_400,
  promotionRevenue: 48_200,
  adRevenue: 214_800,
  activeCampaigns: 842,
  pendingReports: 214,
  verificationRequests: 68,
};

const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const series = (values: number[]) => values.map((value, i) => ({ label: week[i], value }));

export const dashboardCharts = {
  signups: series([8400, 9200, 8800, 11400, 14200, 18400, 12840]),
  uploads: series([124000, 138000, 129000, 156000, 178000, 214000, 184200]),
  watchTime: series([480000, 520000, 498000, 610000, 720000, 890000, 640000]),
  revenue: series([28400, 31200, 29800, 38400, 44200, 58400, 41200]),
};

export const liveActivity = [
  { id: 'a1', text: 'New verification request from @pixelforge', kind: 'verification', at: hoursAgo(0.2) },
  { id: 'a2', text: 'Campaign "Autumn collection" hit its daily budget', kind: 'ads', at: hoursAgo(0.5) },
  { id: 'a3', text: '14 videos flagged by the spam classifier', kind: 'moderation', at: hoursAgo(0.8) },
  { id: 'a4', text: 'Coin package "10,000 + 2,000" purchased 412 times today', kind: 'coins', at: hoursAgo(1.2) },
  { id: 'a5', text: 'Live stream by @driftlab passed 12k concurrent viewers', kind: 'live', at: hoursAgo(1.6) },
  { id: 'a6', text: 'Ranking weight "share" changed 0.70 → 0.75 by A. Rahman', kind: 'ai', at: hoursAgo(2.4) },
  { id: 'a7', text: 'Payment provider webhook latency back to normal', kind: 'system', at: hoursAgo(3.1) },
];

/* ──────────────────────────────── Users ───────────────────────────────── */

export type AdminUserStatus = 'active' | 'suspended' | 'banned' | 'frozen';

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
  email: string;
  type: string;
  category: 'individual' | 'business';
  verified: 'none' | 'individual' | 'creator' | 'business';
  status: AdminUserStatus;
  followers: number;
  videos: number;
  coins: number;
  reports: number;
  country: string;
  joinedAt: string;
  lastActiveAt: string;
}

export const adminUsers: AdminUser[] = [
  { id: 'u_1', username: 'maya.codes', name: 'Maya Chen', avatar: avatar(5), email: 'maya@example.com', type: 'Creator', category: 'individual', verified: 'creator', status: 'active', followers: 892300, videos: 341, coins: 48200, reports: 0, country: 'United States', joinedAt: daysAgo(920), lastActiveAt: hoursAgo(1) },
  { id: 'u_2', username: 'driftlab', name: 'Drift Lab', avatar: avatar(33), email: 'drift@example.com', type: 'Public Figure', category: 'individual', verified: 'individual', status: 'active', followers: 2340000, videos: 612, coins: 184200, reports: 3, country: 'Germany', joinedAt: daysAgo(1200), lastActiveAt: hoursAgo(0.2) },
  { id: 'u_3', username: 'lumen.studio', name: 'Lumen Studio', avatar: avatar(60), email: 'hello@lumen.studio', type: 'Company', category: 'business', verified: 'business', status: 'active', followers: 318000, videos: 208, coins: 92400, reports: 0, country: 'United Kingdom', joinedAt: daysAgo(760), lastActiveAt: hoursAgo(4) },
  { id: 'u_4', username: 'nova.fitness', name: 'Nova', avatar: avatar(45), email: 'nova@example.com', type: 'Professional', category: 'individual', verified: 'none', status: 'active', followers: 45200, videos: 129, coins: 1240, reports: 1, country: 'Canada', joinedAt: daysAgo(210), lastActiveAt: hoursAgo(9) },
  { id: 'u_5', username: 'spam.account.7741', name: 'Spam Account', avatar: avatar(70), email: 'x7741@example.com', type: 'Normal User', category: 'individual', verified: 'none', status: 'banned', followers: 2, videos: 0, coins: 0, reports: 42, country: 'Unknown', joinedAt: daysAgo(12), lastActiveAt: daysAgo(3) },
  { id: 'u_6', username: 'kofi.eats', name: 'Kofi', avatar: avatar(52), email: 'kofi@example.com', type: 'Creator', category: 'individual', verified: 'none', status: 'active', followers: 67400, videos: 264, coins: 8400, reports: 0, country: 'Ghana', joinedAt: daysAgo(430), lastActiveAt: hoursAgo(2) },
  { id: 'u_7', username: 'aurora.shop', name: 'Aurora', avatar: avatar(31), email: 'team@aurora.shop', type: 'Shop', category: 'business', verified: 'business', status: 'active', followers: 89200, videos: 176, coins: 24800, reports: 0, country: 'Portugal', joinedAt: daysAgo(540), lastActiveAt: hoursAgo(6) },
  { id: 'u_8', username: 'theo.finance', name: 'Theo Bennett', avatar: avatar(68), email: 'theo@example.com', type: 'Professional', category: 'individual', verified: 'individual', status: 'suspended', followers: 534000, videos: 297, coins: 61200, reports: 8, country: 'United States', joinedAt: daysAgo(830), lastActiveAt: daysAgo(2) },
  { id: 'u_9', username: 'sana.travels', name: 'Sana Iqbal', avatar: avatar(26), email: 'sana@example.com', type: 'Creator', category: 'individual', verified: 'creator', status: 'active', followers: 1120000, videos: 489, coins: 142000, reports: 1, country: 'Pakistan', joinedAt: daysAgo(1010), lastActiveAt: hoursAgo(3) },
  { id: 'u_10', username: 'pixelforge', name: 'PixelForge', avatar: avatar(15), email: 'dev@pixelforge.io', type: 'Creator', category: 'individual', verified: 'none', status: 'active', followers: 12800, videos: 43, coins: 420, reports: 0, country: 'India', joinedAt: daysAgo(88), lastActiveAt: hoursAgo(0.5) },
  { id: 'u_11', username: 'ravi.builds', name: 'Ravi', avatar: avatar(59), email: 'ravi@example.com', type: 'Normal User', category: 'individual', verified: 'none', status: 'active', followers: 3400, videos: 19, coins: 120, reports: 0, country: 'India', joinedAt: daysAgo(35), lastActiveAt: hoursAgo(7) },
  { id: 'u_12', username: 'echo.music', name: 'Echo', avatar: avatar(20), email: 'echo@example.com', type: 'Creator', category: 'individual', verified: 'creator', status: 'frozen', followers: 760000, videos: 372, coins: 98400, reports: 4, country: 'France', joinedAt: daysAgo(690), lastActiveAt: hoursAgo(12) },
];

/* ──────────────────────────────── Videos ──────────────────────────────── */

export interface AdminVideo {
  id: string;
  poster: string;
  caption: string;
  author: string;
  authorAvatar: string;
  category: string;
  status: 'published' | 'processing' | 'restricted' | 'removed';
  views: number;
  likes: number;
  comments: number;
  completion: number;
  quality: number;
  technical: number;
  safety: 'safe' | 'review' | 'restricted';
  spam: number;
  distribution: 1 | 2 | 3 | 4 | 5;
  reports: number;
  trending: boolean;
  createdAt: string;
}

export const adminVideos: AdminVideo[] = [
  { id: 'v_1', poster: poster('av1'), caption: 'The one thing nobody tells you about async code', author: 'maya.codes', authorAvatar: avatar(5), category: 'Technology', status: 'published', views: 2140000, likes: 318400, comments: 4120, completion: 71, quality: 88, technical: 91, safety: 'safe', spam: 2, distribution: 5, reports: 0, trending: true, createdAt: hoursAgo(6) },
  { id: 'v_2', poster: poster('av2'), caption: 'Six months of work in 30 seconds. The engine finally runs.', author: 'driftlab', authorAvatar: avatar(33), category: 'Cars', status: 'published', views: 8900000, likes: 1240000, comments: 18400, completion: 82, quality: 94, technical: 96, safety: 'safe', spam: 1, distribution: 5, reports: 2, trending: true, createdAt: hoursAgo(19) },
  { id: 'v_3', poster: poster('av3'), caption: 'This street food stall has been open for 41 years', author: 'kofi.eats', authorAvatar: avatar(52), category: 'Food', status: 'published', views: 412000, likes: 71200, comments: 1840, completion: 64, quality: 76, technical: 68, safety: 'safe', spam: 3, distribution: 4, reports: 0, trending: false, createdAt: daysAgo(2) },
  { id: 'v_4', poster: poster('av4'), caption: 'Day 43 of building my game solo. Added water physics.', author: 'pixelforge', authorAvatar: avatar(15), category: 'Gaming', status: 'published', views: 84000, likes: 14200, comments: 620, completion: 58, quality: 72, technical: 64, safety: 'safe', spam: 2, distribution: 3, reports: 0, trending: false, createdAt: hoursAgo(3) },
  { id: 'v_5', poster: poster('av5'), caption: 'First proper dovetail joint. Took me 11 tries.', author: 'ravi.builds', authorAvatar: avatar(59), category: 'Entertainment', status: 'published', views: 8400, likes: 1240, comments: 88, completion: 77, quality: 69, technical: 48, safety: 'safe', spam: 1, distribution: 2, reports: 0, trending: false, createdAt: hoursAgo(2) },
  { id: 'v_6', poster: poster('av6'), caption: 'Get rich in 7 days with this one trick', author: 'spam.account.7741', authorAvatar: avatar(70), category: 'Business', status: 'restricted', views: 1200, likes: 14, comments: 2, completion: 12, quality: 22, technical: 34, safety: 'restricted', spam: 94, distribution: 1, reports: 42, trending: false, createdAt: daysAgo(1) },
  { id: 'v_7', poster: poster('av7'), caption: 'Compound interest, explained with a jar of coins', author: 'theo.finance', authorAvatar: avatar(68), category: 'Education', status: 'published', views: 2900000, likes: 410000, comments: 9200, completion: 69, quality: 87, technical: 85, safety: 'safe', spam: 1, distribution: 5, reports: 1, trending: false, createdAt: daysAgo(4) },
  { id: 'v_8', poster: poster('av8'), caption: 'Sunrise over Hunza. Worth every step.', author: 'sana.travels', authorAvatar: avatar(26), category: 'Travel', status: 'published', views: 3400000, likes: 620000, comments: 8900, completion: 74, quality: 91, technical: 93, safety: 'safe', spam: 1, distribution: 5, reports: 0, trending: true, createdAt: daysAgo(1) },
  { id: 'v_9', poster: poster('av9'), caption: 'Rebranding a 20-year-old company in 4 steps', author: 'lumen.studio', authorAvatar: avatar(60), category: 'Business', status: 'published', views: 1240000, likes: 198000, comments: 3200, completion: 61, quality: 89, technical: 92, safety: 'safe', spam: 2, distribution: 4, reports: 0, trending: false, createdAt: daysAgo(3) },
  { id: 'v_10', poster: poster('av10'), caption: 'New track. Made from a kettle and a broken keyboard.', author: 'echo.music', authorAvatar: avatar(20), category: 'Entertainment', status: 'processing', views: 0, likes: 0, comments: 0, completion: 0, quality: 0, technical: 0, safety: 'safe', spam: 0, distribution: 1, reports: 0, trending: false, createdAt: hoursAgo(0.3) },
];

/* ──────────────────────────── Moderation ──────────────────────────────── */

export interface Report {
  id: string;
  targetType: 'video' | 'user' | 'comment' | 'live' | 'community' | 'group';
  target: string;
  reportedBy: string;
  reason: string;
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'reviewing' | 'actioned' | 'dismissed';
  aiFlag?: string;
  createdAt: string;
}

export const reports: Report[] = [
  { id: 'r_1', targetType: 'video', target: 'Get rich in 7 days with this one trick', reportedBy: '42 users', reason: 'Scam or fraud', count: 42, severity: 'critical', status: 'pending', aiFlag: 'Spam 94%', createdAt: hoursAgo(2) },
  { id: 'r_2', targetType: 'comment', target: 'Comment on "Compound interest…"', reportedBy: '8 users', reason: 'Harassment', count: 8, severity: 'high', status: 'pending', createdAt: hoursAgo(4) },
  { id: 'r_3', targetType: 'user', target: '@harsh.troll', reportedBy: '14 users', reason: 'Harassment or bullying', count: 14, severity: 'high', status: 'reviewing', createdAt: hoursAgo(7) },
  { id: 'r_4', targetType: 'live', target: 'Live by @unknown.host', reportedBy: '3 users', reason: 'Dangerous behaviour', count: 3, severity: 'critical', status: 'pending', aiFlag: 'Unsafe content 71%', createdAt: hoursAgo(0.4) },
  { id: 'r_5', targetType: 'video', target: 'Duplicate of a trending clip', reportedBy: 'AI moderation', reason: 'Duplicate content', count: 1, severity: 'low', status: 'pending', aiFlag: 'Duplicate 88%', createdAt: hoursAgo(9) },
  { id: 'r_6', targetType: 'community', target: 'Garage Builds', reportedBy: '2 users', reason: 'Spam in community', count: 2, severity: 'medium', status: 'reviewing', createdAt: daysAgo(1) },
  { id: 'r_7', targetType: 'video', target: 'Misleading health claims', reportedBy: '19 users', reason: 'Misleading content', count: 19, severity: 'high', status: 'actioned', createdAt: daysAgo(2) },
  { id: 'r_8', targetType: 'group', target: 'Weekend Shoot Crew', reportedBy: '1 user', reason: 'Off-topic', count: 1, severity: 'low', status: 'dismissed', createdAt: daysAgo(3) },
];

export const moderationActions = [
  'No action',
  'Warning',
  'Content removal',
  'Restrict distribution',
  'Temporary restriction',
  'Account suspension',
  'Permanent ban',
];

/* ─────────────────────────── Creative assets ──────────────────────────── */

export const adminFilters = [
  { id: 'f_original', name: 'Original', order: 1, enabled: true, trending: false, premium: false, uses: 41_800_000 },
  { id: 'f_natural', name: 'Natural', order: 2, enabled: true, trending: false, premium: false, uses: 12_400_000 },
  { id: 'f_warm', name: 'Warm', order: 3, enabled: true, trending: true, premium: false, uses: 18_200_000 },
  { id: 'f_cool', name: 'Cool', order: 4, enabled: true, trending: false, premium: false, uses: 9_800_000 },
  { id: 'f_cinematic', name: 'Cinematic', order: 9, enabled: true, trending: true, premium: false, uses: 22_400_000 },
  { id: 'f_vintage', name: 'Vintage', order: 7, enabled: true, trending: true, premium: false, uses: 14_100_000 },
  { id: 'f_bw', name: 'B & W', order: 11, enabled: true, trending: false, premium: false, uses: 6_200_000 },
  { id: 'f_golden', name: 'Golden', order: 17, enabled: true, trending: false, premium: true, uses: 2_100_000 },
  { id: 'f_night', name: 'Night', order: 18, enabled: true, trending: false, premium: true, uses: 1_800_000 },
  { id: 'f_vibrant', name: 'Vibrant', order: 13, enabled: false, trending: false, premium: false, uses: 940_000 },
];

export const adminEffects = [
  { id: 'e_zoom', name: 'Zoom', category: 'motion', enabled: true, trending: true, premium: false, uses: 8_400_000 },
  { id: 'e_glitch', name: 'Glitch', category: 'color', enabled: true, trending: true, premium: false, uses: 6_200_000 },
  { id: 'e_slowmo', name: 'Slow Motion', category: 'time', enabled: true, trending: false, premium: false, uses: 11_800_000 },
  { id: 'e_reverse', name: 'Reverse', category: 'time', enabled: true, trending: false, premium: false, uses: 3_400_000 },
  { id: 'e_greenscreen', name: 'Green Screen', category: 'background', enabled: true, trending: false, premium: false, uses: 4_900_000 },
  { id: 'e_bokeh', name: 'Bokeh', category: 'light', enabled: true, trending: false, premium: true, uses: 1_200_000 },
  { id: 'e_neon', name: 'Neon', category: 'color', enabled: false, trending: false, premium: false, uses: 420_000 },
];

export const stickerPacks = [
  { id: 'sp_emoji', name: 'Emoji', count: 16, enabled: true, uses: 28_400_000 },
  { id: 'sp_reactions', name: 'Reactions', count: 12, enabled: true, uses: 12_100_000 },
  { id: 'sp_creator', name: 'Creator', count: 12, enabled: true, uses: 4_200_000 },
  { id: 'sp_life', name: 'Everyday', count: 12, enabled: false, uses: 890_000 },
];

/* ──────────────────────────────── Music ───────────────────────────────── */

export const adminMusic = [
  { id: 's_1', title: 'Midnight Drive', artist: 'Echo', category: 'Electronic', uses: 1_240_000, status: 'licensed', trending: true, regions: 'Global', enabled: true },
  { id: 's_3', title: 'Golden Hour', artist: 'Lofi Collective', category: 'Lofi', uses: 3_900_000, status: 'licensed', trending: true, regions: 'Global', enabled: true },
  { id: 's_7', title: 'Neon Nights', artist: 'Echo', category: 'Synthwave', uses: 890_000, status: 'licensed', trending: true, regions: 'Global', enabled: true },
  { id: 's_11', title: 'Big Room Energy', artist: 'Volt', category: 'Pop', uses: 1_840_000, status: 'licensed', trending: true, regions: 'Global', enabled: true },
  { id: 's_9', title: 'Retro Arcade', artist: 'BitWave', category: 'Electronic', uses: 412_000, status: 'licensed', trending: false, regions: 'Global', enabled: true },
  { id: 's_12', title: 'Whoosh Pack', artist: 'Platform Sounds', category: 'Sound Effects', uses: 2_400_000, status: 'owned', trending: false, regions: 'Global', enabled: true },
  { id: 's_14', title: 'Chart Hit (disputed)', artist: 'Various', category: 'Pop', uses: 128_000, status: 'disputed', trending: false, regions: 'Blocked in 3', enabled: false },
];

/* ────────────────────────── Categories & tags ─────────────────────────── */

export const adminCategories = [
  { id: 'c_tech', name: 'Technology', videos: 1_840_000, creators: 84_200, enabled: true, subcategories: ['AI', 'Programming', 'Gadgets', 'Startups'] },
  { id: 'c_gaming', name: 'Gaming', videos: 3_210_000, creators: 142_800, enabled: true, subcategories: ['Console', 'PC', 'Mobile', 'Esports'] },
  { id: 'c_business', name: 'Business', videos: 940_000, creators: 41_200, enabled: true, subcategories: ['Marketing', 'Finance', 'Entrepreneurship'] },
  { id: 'c_food', name: 'Food', videos: 3_140_000, creators: 128_400, enabled: true, subcategories: ['Recipes', 'Street Food', 'Restaurants'] },
  { id: 'c_travel', name: 'Travel', videos: 1_680_000, creators: 62_100, enabled: true, subcategories: ['Adventure', 'City Guides', 'Budget'] },
  { id: 'c_beauty', name: 'Beauty', videos: 1_980_000, creators: 91_400, enabled: true, subcategories: ['Skincare', 'Makeup', 'Hair'] },
  { id: 'c_crypto', name: 'Crypto', videos: 128_000, creators: 4_200, enabled: false, subcategories: ['Trading'] },
];

export const adminHashtags = [
  { id: 'h_1', tag: 'buildinpublic', views: 2_840_000_000, videos: 1_240_000, status: 'normal', featured: true },
  { id: 'h_4', tag: 'streetfood', views: 4_210_000_000, videos: 2_100_000, status: 'normal', featured: false },
  { id: 'h_5', tag: 'sunrisechallenge', views: 620_000_000, videos: 412_000, status: 'official', featured: true },
  { id: 'h_7', tag: 'autumncollection', views: 128_000_000, videos: 42_000, status: 'sponsored', featured: false },
  { id: 'h_9', tag: 'moneytalk', views: 1_980_000_000, videos: 890_000, status: 'restricted', featured: false },
  { id: 'h_12', tag: 'getrichquick', views: 12_000_000, videos: 8_400, status: 'blocked', featured: false },
];

/* ──────────────────────────────── Live ────────────────────────────────── */

export const adminLive = [
  { id: 'l_1', host: 'driftlab', avatar: avatar(33), title: 'Engine rebuild — final assembly', category: 'Cars', viewers: 12840, gifts: 24800, reports: 0, duration: 74, startedAt: hoursAgo(1.2) },
  { id: 'l_2', host: 'echo.music', avatar: avatar(20), title: 'Making a beat from scratch', category: 'Music', viewers: 6210, gifts: 11400, reports: 0, duration: 38, startedAt: hoursAgo(0.6) },
  { id: 'l_3', host: 'sana.travels', avatar: avatar(26), title: 'Sunrise walk in Hunza', category: 'Travel', viewers: 3480, gifts: 5200, reports: 1, duration: 112, startedAt: hoursAgo(1.9) },
  { id: 'l_4', host: 'unknown.host', avatar: avatar(70), title: 'Untitled stream', category: 'Just Chatting', viewers: 940, gifts: 40, reports: 6, duration: 21, startedAt: hoursAgo(0.35) },
  { id: 'l_5', host: 'maya.codes', avatar: avatar(5), title: 'Code review of your projects', category: 'Technology', viewers: 8940, gifts: 18200, reports: 0, duration: 56, startedAt: hoursAgo(0.9) },
];

/* ────────────────────────── Chat & communities ────────────────────────── */

export const adminCommunities = [
  { id: 'cm_1', name: 'Creators Who Code', owner: 'maya.codes', members: 24800, privacy: 'public', requests: 0, reports: 1, activity: 'high' },
  { id: 'cm_2', name: 'Garage Builds', owner: 'driftlab', members: 8420, privacy: 'private', requests: 23, reports: 2, activity: 'high' },
  { id: 'cm_3', name: 'Street Food Hunters', owner: 'kofi.eats', members: 61200, privacy: 'public', requests: 7, reports: 0, activity: 'medium' },
  { id: 'cm_4', name: 'Crypto Signals', owner: 'spam.account.7741', members: 1240, privacy: 'private', requests: 412, reports: 18, activity: 'suspicious' },
];

export const adminGroups = [
  { id: 'g_1', name: 'Editor Beta Testers', owner: 'lumen.studio', members: 42, reports: 0, createdAt: daysAgo(120) },
  { id: 'g_2', name: 'Weekend Shoot Crew', owner: 'driftlab', members: 12, reports: 1, createdAt: daysAgo(64) },
  { id: 'g_3', name: 'Music Producers PK', owner: 'echo.music', members: 218, reports: 0, createdAt: daysAgo(210) },
];

/* ──────────────────────────────── Money ───────────────────────────────── */

export const coinPackages = [
  { id: 'cp_1', coins: 100, bonus: 0, price: 1.29, currency: 'USD', enabled: true, sales: 41_200 },
  { id: 'cp_2', coins: 500, bonus: 25, price: 5.99, currency: 'USD', enabled: true, sales: 28_400 },
  { id: 'cp_3', coins: 1000, bonus: 80, price: 11.49, currency: 'USD', enabled: true, sales: 62_100, popular: true },
  { id: 'cp_4', coins: 2500, bonus: 300, price: 27.99, currency: 'USD', enabled: true, sales: 18_900, discount: 10 },
  { id: 'cp_5', coins: 5000, bonus: 750, price: 54.99, currency: 'USD', enabled: true, sales: 9_400, discount: 15 },
  { id: 'cp_6', coins: 10000, bonus: 2000, price: 99.99, currency: 'USD', enabled: false, sales: 4_100, discount: 20 },
];

export const adminGifts = [
  { id: 'g_rose', name: 'Rose', icon: '🌹', coins: 10, active: true, featured: false, sent: 8_420_000 },
  { id: 'g_heart', name: 'Heart', icon: '❤️', coins: 25, active: true, featured: false, sent: 4_100_000 },
  { id: 'g_star', name: 'Star', icon: '⭐', coins: 50, active: true, featured: false, sent: 2_800_000 },
  { id: 'g_fire', name: 'Fire', icon: '🔥', coins: 100, active: true, featured: true, sent: 1_940_000 },
  { id: 'g_crown', name: 'Crown', icon: '👑', coins: 500, active: true, featured: true, sent: 412_000 },
  { id: 'g_diamond', name: 'Diamond', icon: '💎', coins: 1500, active: true, featured: true, sent: 128_000 },
  { id: 'g_galaxy', name: 'Galaxy', icon: '🌌', coins: 5000, active: false, featured: false, sent: 12_400 },
];

export const payments = [
  { id: 'PAY-77120934', user: 'maya.codes', amount: 11.49, currency: 'USD', coins: 1080, method: 'Card •••• 4242', status: 'successful', at: hoursAgo(1) },
  { id: 'PAY-77120911', user: 'driftlab', amount: 99.99, currency: 'USD', coins: 12000, method: 'Apple Pay', status: 'successful', at: hoursAgo(2) },
  { id: 'PAY-77120880', user: 'ravi.builds', amount: 1.29, currency: 'USD', coins: 100, method: 'Google Pay', status: 'failed', at: hoursAgo(3) },
  { id: 'PAY-77120845', user: 'aurora.shop', amount: 54.99, currency: 'USD', coins: 5750, method: 'Card •••• 1881', status: 'successful', at: hoursAgo(5) },
  { id: 'PAY-77120802', user: 'pixelforge', amount: 5.99, currency: 'USD', coins: 525, method: 'PayPal', status: 'pending', at: hoursAgo(6) },
  { id: 'PAY-77120744', user: 'theo.finance', amount: 27.99, currency: 'USD', coins: 2800, method: 'Card •••• 9021', status: 'refunded', at: daysAgo(1) },
  { id: 'PAY-77120701', user: 'sana.travels', amount: 11.49, currency: 'USD', coins: 1080, method: 'Card •••• 3312', status: 'successful', at: daysAgo(1) },
];

export const adminCampaigns = [
  { id: 'camp_1', name: 'Editor launch', advertiser: 'maya.codes', objective: 'Video views', status: 'active', budget: 1200, spent: 840, reach: 142800, results: 96400, cpr: 0.009, submittedAt: daysAgo(3) },
  { id: 'camp_2', name: 'Autumn collection', advertiser: 'aurora.shop', objective: 'Website traffic', status: 'completed', budget: 900, spent: 900, reach: 71200, results: 6840, cpr: 0.13, submittedAt: daysAgo(14) },
  { id: 'camp_3', name: 'Community growth', advertiser: 'pixelforge', objective: 'Followers', status: 'pending_review', budget: 600, spent: 0, reach: 0, results: 0, cpr: 0, submittedAt: hoursAgo(4) },
  { id: 'camp_4', name: 'App install push', advertiser: 'lumen.studio', objective: 'App promotion', status: 'paused', budget: 2400, spent: 1180, reach: 188000, results: 14200, cpr: 0.083, submittedAt: daysAgo(9) },
  { id: 'camp_5', name: 'Crypto giveaway', advertiser: 'spam.account.7741', objective: 'Engagement', status: 'rejected', budget: 5000, spent: 0, reach: 0, results: 0, cpr: 0, submittedAt: daysAgo(2) },
];

/* ────────────────────────────── Verification ──────────────────────────── */

export const verificationRequests = [
  { id: 'vr_1', user: 'pixelforge', avatar: avatar(15), tier: 'creator', followers: 12800, submittedAt: hoursAgo(4), documents: 2, status: 'pending' },
  { id: 'vr_2', user: 'kofi.eats', avatar: avatar(52), tier: 'creator', followers: 67400, submittedAt: hoursAgo(9), documents: 2, status: 'pending' },
  { id: 'vr_3', user: 'aurora.shop', avatar: avatar(31), tier: 'business', followers: 89200, submittedAt: daysAgo(1), documents: 3, status: 'reviewing' },
  { id: 'vr_4', user: 'nova.fitness', avatar: avatar(45), tier: 'individual', followers: 45200, submittedAt: daysAgo(2), documents: 1, status: 'more_info' },
  { id: 'vr_5', user: 'ravi.builds', avatar: avatar(59), tier: 'creator', followers: 3400, submittedAt: daysAgo(3), documents: 1, status: 'rejected' },
  { id: 'vr_6', user: 'sana.travels', avatar: avatar(26), tier: 'creator', followers: 1120000, submittedAt: daysAgo(6), documents: 2, status: 'approved' },
];

/* ────────────────────────── AI / recommendation ───────────────────────── */

export const rankingWeights = [
  { id: 'watch', label: 'Watch probability', value: 1.0, min: 0, max: 2 },
  { id: 'completion', label: 'Completion rate', value: 0.9, min: 0, max: 2 },
  { id: 'watch20', label: '20s watch (20–30s videos)', value: 0.85, min: 0, max: 2 },
  { id: 'watch30', label: '30s watch (>30s videos)', value: 0.85, min: 0, max: 2 },
  { id: 'rewatch', label: 'Rewatch', value: 0.7, min: 0, max: 2 },
  { id: 'like', label: 'Like', value: 0.55, min: 0, max: 2 },
  { id: 'comment', label: 'Comment', value: 0.6, min: 0, max: 2 },
  { id: 'share', label: 'Share', value: 0.75, min: 0, max: 2 },
  { id: 'save', label: 'Save', value: 0.65, min: 0, max: 2 },
  { id: 'follow', label: 'Follow from video', value: 0.8, min: 0, max: 2 },
  { id: 'profile', label: 'Profile visit', value: 0.35, min: 0, max: 2 },
  { id: 'affinity', label: 'Creator affinity', value: 0.7, min: 0, max: 2 },
  { id: 'interest', label: 'Interest match', value: 0.85, min: 0, max: 2 },
  { id: 'freshness', label: 'Freshness', value: 0.4, min: 0, max: 2 },
  { id: 'quality', label: 'Technical quality', value: 0.2, min: 0, max: 2 },
  { id: 'trending', label: 'Trending momentum', value: 0.3, min: 0, max: 2 },
];

export const penaltyWeights = [
  { id: 'negative', label: 'Negative feedback penalty', value: -1.2, min: -3, max: 0 },
  { id: 'quickskip', label: 'Quick skip penalty', value: -0.8, min: -3, max: 0 },
  { id: 'repetition', label: 'Repetition penalty', value: -0.6, min: -3, max: 0 },
];

export const explorationSettings = {
  newCreatorRate: 10,
  freshVideoRate: 15,
  diversityStrength: 35,
  candidatePoolSize: 800,
};

export const aiModels = [
  { id: 'm_v2', name: 'Ranker v2 — collaborative filtering', version: '2.4.1', status: 'live', rollout: 100, deployedAt: daysAgo(28), metric: 'D7 retention +3.2%' },
  { id: 'm_v3', name: 'Ranker v3 — learning to rank', version: '3.0.0-rc4', status: 'experiment', rollout: 10, deployedAt: daysAgo(4), metric: 'Watch time +5.1%' },
  { id: 'm_v1', name: 'Ranker v1 — rules + weights', version: '1.9.2', status: 'fallback', rollout: 0, deployedAt: daysAgo(120), metric: 'Always available' },
  { id: 'm_q', name: 'Quality scorer', version: '1.4.0', status: 'live', rollout: 100, deployedAt: daysAgo(45), metric: 'Agreement 91%' },
  { id: 'm_mod', name: 'Moderation classifier', version: '2.1.0', status: 'live', rollout: 100, deployedAt: daysAgo(18), metric: 'Precision 94%' },
];

export const experiments = [
  { id: 'EXP-20260812-01', hypothesis: 'Higher share weight increases D7 retention', variants: 'control / +0.05 share', traffic: '90/10', metric: 'D7 retention', result: '+1.8%', status: 'running', startedAt: daysAgo(12) },
  { id: 'EXP-20260801-02', hypothesis: 'Raising new-creator exploration to 15% grows supply', variants: '10% / 15%', traffic: '80/20', metric: 'Creator retention', result: '+4.2% creators, -0.3% watch time', status: 'running', startedAt: daysAgo(24) },
  { id: 'EXP-20260710-01', hypothesis: 'Stronger diversity reduces session fatigue', variants: '35 / 55', traffic: '50/50', metric: 'Session length', result: '-2.1% (guardrail tripped)', status: 'stopped', startedAt: daysAgo(50) },
];

/* ──────────────────────────── Platform ops ────────────────────────────── */

export const featureFlags = [
  { id: 'video_upload', label: 'Video upload', description: 'Master switch for publishing new videos', enabled: true, rollout: 100 },
  { id: 'live_streaming', label: 'Live streaming', description: 'Start-live capability for eligible accounts', enabled: true, rollout: 100 },
  { id: 'calling', label: 'Voice and video calls', description: 'WebRTC calling between users', enabled: true, rollout: 100 },
  { id: 'group_chat', label: 'Group chat', description: 'Multi-participant conversations', enabled: true, rollout: 100 },
  { id: 'communities', label: 'Communities', description: 'Community creation and membership', enabled: true, rollout: 100 },
  { id: 'gifts', label: 'Gifts', description: 'Sending gifts during live streams', enabled: true, rollout: 100 },
  { id: 'coins', label: 'Coins', description: 'Coin purchase and spending', enabled: true, rollout: 100 },
  { id: 'ads', label: 'Advertising', description: 'Self-service campaign manager', enabled: true, rollout: 100 },
  { id: 'promotion', label: 'Video promotion', description: 'Coin-funded creator boosts', enabled: true, rollout: 100 },
  { id: 'business_accounts', label: 'Business accounts', description: 'Business profile and tooling', enabled: true, rollout: 100 },
  { id: 'verification', label: 'Verification', description: 'Badge applications and review', enabled: true, rollout: 100 },
  { id: 'new_reco', label: 'New recommendation engine', description: 'Ranker v3 learning-to-rank', enabled: true, rollout: 10 },
  { id: 'new_editor', label: 'New video editor', description: 'Rebuilt timeline and GPU filters', enabled: false, rollout: 0 },
];

export const systemHealth = [
  { id: 'api', label: 'API', status: 'operational', metric: 'p95 142ms', detail: '12 instances' },
  { id: 'db', label: 'MySQL', status: 'operational', metric: '212 conns', detail: '1 primary, 2 replicas' },
  { id: 'redis', label: 'Redis', status: 'operational', metric: '4.2 GB used', detail: 'cache + queues' },
  { id: 'queue', label: 'Queues', status: 'degraded', metric: '8,412 pending', detail: 'transcode backlog rising' },
  { id: 'storage', label: 'Object storage', status: 'operational', metric: '184 TB', detail: 'replication healthy' },
  { id: 'transcode', label: 'Video processing', status: 'degraded', metric: '6m avg', detail: 'scaling workers' },
  { id: 'live', label: 'Live streaming', status: 'operational', metric: '1,284 live', detail: 'SFU cluster nominal' },
  { id: 'notifications', label: 'Notifications', status: 'operational', metric: '99.2% delivered', detail: 'APNs + FCM' },
  { id: 'ml', label: 'ML ranker', status: 'operational', metric: 'p95 38ms', detail: 'fallback armed' },
  { id: 'payments', label: 'Payments', status: 'operational', metric: '98.7% success', detail: 'provider nominal' },
];

export const failedJobs = [
  { id: 'j_1', job: 'transcode:1080p', target: 'v_10', attempts: 3, error: 'ffmpeg exit 1 — corrupt frame at 00:12', at: hoursAgo(0.4) },
  { id: 'j_2', job: 'notify:push', target: 'u_842', attempts: 5, error: 'APNs BadDeviceToken', at: hoursAgo(1.1) },
  { id: 'j_3', job: 'quality:score', target: 'v_881', attempts: 2, error: 'ml-service timeout after 30s', at: hoursAgo(2.3) },
];

export const auditLog = [
  { id: 'al_1', admin: 'A. Rahman', role: 'AI Manager', action: 'Updated ranking weight', module: 'Recommendation', target: 'share', oldValue: '0.70', newValue: '0.75', reason: 'Experiment EXP-20260812-01 rollout', at: hoursAgo(2.4), ip: '203.0.113.14' },
  { id: 'al_2', admin: 'S. Malik', role: 'Moderator', action: 'Banned user', module: 'Users', target: '@spam.account.7741', oldValue: 'active', newValue: 'banned', reason: '42 scam reports confirmed', at: hoursAgo(3.1), ip: '203.0.113.22' },
  { id: 'al_3', admin: 'J. Okafor', role: 'Finance Manager', action: 'Manual coin credit', module: 'Coins', target: '@ravi.builds', oldValue: '120', newValue: '220', reason: 'Failed purchase PAY-77120880 compensation', at: hoursAgo(5.6), ip: '203.0.113.9' },
  { id: 'al_4', admin: 'A. Rahman', role: 'AI Manager', action: 'Started experiment', module: 'AI Models', target: 'Ranker v3', oldValue: '0%', newValue: '10%', reason: 'Offline eval passed', at: daysAgo(4), ip: '203.0.113.14' },
  { id: 'al_5', admin: 'L. Fernandes', role: 'Verification Manager', action: 'Approved verification', module: 'Verification', target: '@sana.travels', oldValue: 'pending', newValue: 'creator', reason: 'ID and originality confirmed', at: daysAgo(6), ip: '203.0.113.31' },
  { id: 'al_6', admin: 'S. Malik', role: 'Moderator', action: 'Restricted distribution', module: 'Videos', target: 'v_6', oldValue: 'L4', newValue: 'L1', reason: 'Scam probability 94%', at: daysAgo(1), ip: '203.0.113.22' },
  { id: 'al_7', admin: 'Super Admin', role: 'Super Admin', action: 'Disabled feature flag', module: 'Feature Flags', target: 'new_editor', oldValue: 'on', newValue: 'off', reason: 'Crash rate regression on Android 10', at: daysAgo(2), ip: '203.0.113.1' },
];

export const adminAccounts = [
  { id: 'ad_1', name: 'Super Admin', email: 'root@vyra.app', role: 'super_admin', twoFactor: true, lastLogin: hoursAgo(0.3), status: 'active' },
  { id: 'ad_2', name: 'A. Rahman', email: 'a.rahman@vyra.app', role: 'ai_manager', twoFactor: true, lastLogin: hoursAgo(2.4), status: 'active' },
  { id: 'ad_3', name: 'S. Malik', email: 's.malik@vyra.app', role: 'moderator', twoFactor: true, lastLogin: hoursAgo(3.1), status: 'active' },
  { id: 'ad_4', name: 'J. Okafor', email: 'j.okafor@vyra.app', role: 'finance_manager', twoFactor: true, lastLogin: hoursAgo(5.6), status: 'active' },
  { id: 'ad_5', name: 'L. Fernandes', email: 'l.fernandes@vyra.app', role: 'verification_manager', twoFactor: false, lastLogin: daysAgo(6), status: 'active' },
  { id: 'ad_6', name: 'D. Kim', email: 'd.kim@vyra.app', role: 'support_agent', twoFactor: false, lastLogin: daysAgo(21), status: 'disabled' },
];

export const loginActivity = [
  { id: 'la_1', admin: 'Super Admin', ip: '203.0.113.1', location: 'Lahore, PK', device: 'Chrome / macOS', status: 'success', at: hoursAgo(0.3) },
  { id: 'la_2', admin: 'A. Rahman', ip: '203.0.113.14', location: 'Karachi, PK', device: 'Firefox / Windows', status: 'success', at: hoursAgo(2.4) },
  { id: 'la_3', admin: 'unknown', ip: '198.51.100.77', location: 'Unknown', device: 'curl/8.4', status: 'blocked', at: hoursAgo(4.2) },
  { id: 'la_4', admin: 'S. Malik', ip: '203.0.113.22', location: 'Dubai, AE', device: 'Chrome / Windows', status: 'success', at: hoursAgo(3.1) },
  { id: 'la_5', admin: 'D. Kim', ip: '198.51.100.14', location: 'Seoul, KR', device: 'Safari / iOS', status: 'failed', at: daysAgo(1) },
];

export const supportTickets = [
  { id: 'TK-1041', subject: 'Coins not credited after purchase', user: 'ravi.builds', category: 'coins', priority: 'high', status: 'in_progress', assignee: 'D. Kim', messages: 4, updatedAt: hoursAgo(2) },
  { id: 'TK-1038', subject: 'Video stuck on processing', user: 'echo.music', category: 'video', priority: 'medium', status: 'waiting', assignee: 'D. Kim', messages: 3, updatedAt: daysAgo(1) },
  { id: 'TK-1035', subject: 'Cannot go live after update', user: 'nova.fitness', category: 'technical', priority: 'high', status: 'open', assignee: null, messages: 1, updatedAt: hoursAgo(6) },
  { id: 'TK-1029', subject: 'Business verification documents', user: 'aurora.shop', category: 'verification', priority: 'low', status: 'resolved', assignee: 'L. Fernandes', messages: 7, updatedAt: daysAgo(9) },
  { id: 'TK-1012', subject: 'Campaign rejected without reason', user: 'spam.account.7741', category: 'advertisement', priority: 'low', status: 'closed', assignee: 'J. Okafor', messages: 5, updatedAt: daysAgo(20) },
];

export const banners = [
  { id: 'bn_1', title: 'Sunrise Challenge', placement: 'Explore top', status: 'live', impressions: 4_200_000, clicks: 184_000, startsAt: daysAgo(6), endsAt: daysAgo(-8) },
  { id: 'bn_2', title: 'New: Cinematic filters', placement: 'Explore top', status: 'live', impressions: 2_800_000, clicks: 128_000, startsAt: daysAgo(3), endsAt: daysAgo(-11) },
  { id: 'bn_3', title: 'Creator Fund is open', placement: 'Home promo', status: 'scheduled', impressions: 0, clicks: 0, startsAt: daysAgo(-2), endsAt: daysAgo(-30) },
  { id: 'bn_4', title: 'Ramadan collection', placement: 'Campaign banner', status: 'ended', impressions: 8_400_000, clicks: 412_000, startsAt: daysAgo(120), endsAt: daysAgo(90) },
];

export const notificationCampaigns = [
  { id: 'nc_1', title: 'New filters are live', audience: 'All users', sent: 4_182_400, opened: 1_240_000, status: 'sent', at: daysAgo(2) },
  { id: 'nc_2', title: 'Creator Fund applications open', audience: 'Creators (10k+)', sent: 218_400, opened: 128_400, status: 'sent', at: daysAgo(5) },
  { id: 'nc_3', title: 'Scheduled maintenance Sunday 02:00 UTC', audience: 'All users', sent: 0, opened: 0, status: 'scheduled', at: daysAgo(-2) },
  { id: 'nc_4', title: 'Business tools update', audience: 'Business accounts', sent: 14_920, opened: 8_120, status: 'sent', at: daysAgo(9) },
];

export const countries = [
  { code: 'US', name: 'United States', users: 842_000, enabled: true, currency: 'USD', ads: true, business: true, verification: true },
  { code: 'GB', name: 'United Kingdom', users: 412_000, enabled: true, currency: 'GBP', ads: true, business: true, verification: true },
  { code: 'PK', name: 'Pakistan', users: 684_000, enabled: true, currency: 'PKR', ads: true, business: true, verification: true },
  { code: 'IN', name: 'India', users: 921_000, enabled: true, currency: 'INR', ads: true, business: true, verification: false },
  { code: 'DE', name: 'Germany', users: 284_000, enabled: true, currency: 'EUR', ads: true, business: true, verification: true },
  { code: 'AE', name: 'UAE', users: 148_000, enabled: true, currency: 'AED', ads: true, business: true, verification: true },
  { code: 'NG', name: 'Nigeria', users: 212_000, enabled: true, currency: 'NGN', ads: false, business: true, verification: false },
  { code: 'CN', name: 'China', users: 0, enabled: false, currency: 'CNY', ads: false, business: false, verification: false },
];

export const appSettings = {
  appName: 'Vyra',
  latestVersion: '1.0.0',
  minSupportedVersion: '1.0.0',
  maintenanceMode: false,
  maintenanceMessage: 'We are performing scheduled maintenance and will be back shortly.',
  maxVideoDurationSec: 600,
  maxFileSizeMb: 500,
  supportedFormats: 'mp4, mov, m4v',
  privacyPolicyUrl: 'https://example.com/privacy',
  termsUrl: 'https://example.com/terms',
  guidelinesUrl: 'https://example.com/guidelines',
};

export const boostSettings = {
  minCoins: 100,
  maxCoins: 50_000,
  minDurationDays: 1,
  maxDurationDays: 30,
  reachPerCoin: 118,
  dailyBudgetCap: 10_000,
  restrictedCategories: ['Crypto', 'Gambling', 'Political'],
  boostEnabled: true,
};

/* ─────────────────────────────── Analytics ────────────────────────────── */

export const analytics = {
  retention: [
    { label: 'D1', value: 42 },
    { label: 'D3', value: 31 },
    { label: 'D7', value: 24 },
    { label: 'D14', value: 19 },
    { label: 'D30', value: 14 },
  ],
  topCategories: [
    { label: 'Entertainment', percent: 24 },
    { label: 'Gaming', percent: 18 },
    { label: 'Food', percent: 14 },
    { label: 'Technology', percent: 12 },
    { label: 'Travel', percent: 9 },
  ],
  topCountries: [
    { label: 'India', percent: 22 },
    { label: 'United States', percent: 20 },
    { label: 'Pakistan', percent: 16 },
    { label: 'United Kingdom', percent: 10 },
    { label: 'Germany', percent: 7 },
  ],
  searchTrends: [
    { term: 'video editing tips', volume: 412_000, change: 18 },
    { term: 'engine rebuild', volume: 284_000, change: 42 },
    { term: 'lofi beats', volume: 218_000, change: -6 },
    { term: 'street food accra', volume: 142_000, change: 128 },
    { term: 'how the algorithm works', volume: 98_000, change: 24 },
  ],
  revenueSplit: [
    { label: 'Advertising', percent: 42 },
    { label: 'Coin sales', percent: 31 },
    { label: 'Gifts', percent: 18 },
    { label: 'Promotions', percent: 9 },
  ],
};

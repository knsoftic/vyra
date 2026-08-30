/**
 * Admin module registry.
 *
 * Every module declares the permission key the backend will enforce in Phase 11.
 * The sidebar is rendered from this list, so a module cannot exist without
 * declaring who is allowed to reach it.
 */

export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'moderator'
  | 'video_moderator'
  | 'live_moderator'
  | 'community_moderator'
  | 'verification_manager'
  | 'verification_officer'
  | 'ads_manager'
  | 'finance_manager'
  | 'support_agent'
  | 'content_manager'
  | 'ai_manager';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: string;
  badge?: 'reports' | 'verification' | 'support' | 'campaigns' | 'coinRequests' | 'withdrawals';
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'grid', permission: 'dashboard.view' },
      { href: '/analytics', label: 'Analytics', icon: 'chart', permission: 'analytics.view' },
      { href: '/health', label: 'System Health', icon: 'pulse', permission: 'health.view' },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/users', label: 'Users', icon: 'users', permission: 'users.view' },
      { href: '/verification', label: 'Verification', icon: 'check', permission: 'verification.view', badge: 'verification' },
      { href: '/roles', label: 'Roles & Permissions', icon: 'key', permission: 'roles.view' },
    ],
  },
  {
    title: 'Content',
    items: [
      { href: '/videos', label: 'Videos', icon: 'video', permission: 'videos.view' },
      { href: '/comments', label: 'Comments', icon: 'comment', permission: 'comments.view' },
      { href: '/categories', label: 'Categories', icon: 'folder', permission: 'categories.view' },
      { href: '/hashtags', label: 'Hashtags', icon: 'tag', permission: 'hashtags.view' },
      { href: '/creative', label: 'Filters & Effects', icon: 'wand', permission: 'creative.view' },
      { href: '/music', label: 'Music & Audio', icon: 'music', permission: 'music.view' },
    ],
  },
  {
    title: 'Community',
    items: [
      { href: '/live', label: 'Live Streams', icon: 'radio', permission: 'live.view' },
      { href: '/communities', label: 'Chat & Communities', icon: 'chat', permission: 'communities.view' },
      { href: '/moderation', label: 'Moderation', icon: 'shield', permission: 'moderation.view', badge: 'reports' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/coins', label: 'Coins', icon: 'coin', permission: 'coins.view' },
      { href: '/gifts', label: 'Gifts', icon: 'gift', permission: 'gifts.view' },
      { href: '/payments', label: 'Payments', icon: 'card', permission: 'payments.view' },
      { href: '/ads', label: 'Ad Campaigns', icon: 'megaphone', permission: 'ads.view', badge: 'campaigns' },
      { href: '/boost', label: 'Boost Settings', icon: 'trending', permission: 'boost.manage' },
    ],
  },
  {
    title: 'Monetization',
    items: [
      { href: '/coin-requests', label: 'Coin Requests', icon: 'card', permission: 'coins.approve', badge: 'coinRequests' },
      { href: '/withdrawals', label: 'Withdrawals', icon: 'trending', permission: 'payouts.approve', badge: 'withdrawals' },
      { href: '/monetization', label: 'Criteria & Creators', icon: 'check', permission: 'monetization.manage' },
      { href: '/tasks', label: 'Daily Tasks', icon: 'list', permission: 'tasks.manage' },
      { href: '/rates', label: 'Rates & Methods', icon: 'coin', permission: 'rates.manage' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { href: '/recommendation', label: 'Recommendation', icon: 'sliders', permission: 'ai.manage' },
      { href: '/models', label: 'AI Models', icon: 'cpu', permission: 'ai.manage' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { href: '/notifications', label: 'Notifications', icon: 'bell', permission: 'notifications.send' },
      { href: '/banners', label: 'Banners & Promos', icon: 'image', permission: 'banners.manage' },
      { href: '/support', label: 'Support Tickets', icon: 'lifebuoy', permission: 'support.view', badge: 'support' },
      { href: '/flags', label: 'Feature Flags', icon: 'flag', permission: 'flags.manage' },
      { href: '/settings', label: 'App Settings', icon: 'settings', permission: 'settings.manage' },
      { href: '/regions', label: 'Countries & Regions', icon: 'globe', permission: 'regions.manage' },
      { href: '/security', label: 'Security', icon: 'lock', permission: 'security.view' },
      { href: '/audit', label: 'Audit Log', icon: 'list', permission: 'audit.view' },
    ],
  },
];

export const allNavItems: NavItem[] = navigation.flatMap((group) => group.items);

/** Permissions every module exposes. Enforced server-side in Phase 11. */
export const permissionActions = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'suspend',
  'export',
  'manage_settings',
] as const;

export const roleLabels: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  moderator: 'Moderator',
  video_moderator: 'Video Moderator',
  live_moderator: 'Live Moderator',
  community_moderator: 'Community Moderator',
  verification_manager: 'Verification Manager',
  verification_officer: 'Verification Officer',
  ads_manager: 'Ads Manager',
  finance_manager: 'Finance Manager',
  support_agent: 'Support Agent',
  content_manager: 'Content Manager',
  ai_manager: 'AI / Recommendation Manager',
};

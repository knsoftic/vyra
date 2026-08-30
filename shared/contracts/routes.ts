/**
 * The route table. One definition, used by the server to mount handlers and by
 * both clients to build URLs — so a renamed path breaks the build rather than
 * failing silently at runtime.
 */

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}` as const;

export const ROUTES = {
  health: '/health',
  ready: '/ready',

  auth: {
    register: '/auth/register',
    login: '/auth/login',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all',
    refresh: '/auth/refresh',
    otpRequest: '/auth/otp/request',
    otpVerify: '/auth/otp/verify',
    resetPassword: '/auth/password/reset',
    changePassword: '/auth/password/change',
    sessions: '/auth/sessions',
    revokeSession: (id: string) => `/auth/sessions/${id}`,
  },

  me: {
    profile: '/me',
    updateProfile: '/me',
    privacy: '/me/privacy',
    accountType: '/me/account-type',
    businessProfile: '/me/business',
    securityEvents: '/me/security-events',
    settings: '/me/settings',
    notifications: '/me/notifications',
    blocked: '/me/blocked',
  },

  users: {
    checkUsername: '/users/check-username',
    byUsername: (username: string) => `/users/${username}`,
    videos: (id: string) => `/users/${id}/videos`,
    followers: (id: string) => `/users/${id}/followers`,
    following: (id: string) => `/users/${id}/following`,
    follow: (id: string) => `/users/${id}/follow`,
    block: (id: string) => `/users/${id}/block`,
  },

  videos: {
    uploadInit: '/videos/upload-init',
    publish: '/videos',
    byId: (id: string) => `/videos/${id}`,
    like: (id: string) => `/videos/${id}/like`,
    save: (id: string) => `/videos/${id}/save`,
    share: (id: string) => `/videos/${id}/share`,
    comments: (id: string) => `/videos/${id}/comments`,
    drafts: '/videos/drafts',
  },

  comments: {
    byId: (id: string) => `/comments/${id}`,
    like: (id: string) => `/comments/${id}/like`,
    replies: (id: string) => `/comments/${id}/replies`,
  },

  feed: {
    list: '/feed',
    signals: '/feed/signals',
  },

  discover: {
    search: '/discover/search',
    trending: '/discover/trending',
    categories: '/discover/categories',
    hashtag: (tag: string) => `/discover/hashtags/${tag}`,
    sounds: '/discover/sounds',
  },

  chats: {
    list: '/chats',
    byId: (id: string) => `/chats/${id}`,
    messages: (id: string) => `/chats/${id}/messages`,
    read: (id: string) => `/chats/${id}/read`,
  },

  communities: {
    list: '/communities',
    byId: (id: string) => `/communities/${id}`,
    join: (id: string) => `/communities/${id}/join`,
    members: (id: string) => `/communities/${id}/members`,
  },

  calls: {
    history: '/calls',
    start: '/calls',
    byId: (id: string) => `/calls/${id}`,
  },

  live: {
    list: '/live',
    start: '/live',
    byId: (id: string) => `/live/${id}`,
    join: (id: string) => `/live/${id}/join`,
    comments: (id: string) => `/live/${id}/comments`,
    end: (id: string) => `/live/${id}/end`,
  },

  wallet: {
    summary: '/wallet',
    ledger: '/wallet/ledger',
    convertReward: '/wallet/convert',
    packages: '/wallet/packages',
    rates: '/wallet/rates',
    quote: '/wallet/quote',
    paymentMethods: '/wallet/payment-methods',
    purchases: '/wallet/purchases',
    purchaseById: (id: string) => `/wallet/purchases/${id}`,
    withdrawalMethods: '/wallet/withdrawal-methods',
    withdrawals: '/wallet/withdrawals',
    liveEarnings: '/wallet/live-earnings',
  },

  gifts: {
    catalog: '/gifts',
    send: '/gifts/send',
  },

  monetization: {
    status: '/monetization/status',
    apply: '/monetization/apply',
    config: '/monetization/config',
    tasks: '/monetization/tasks',
    claimTask: (id: string) => `/monetization/tasks/${id}/claim`,
    referrals: '/monetization/referrals',
    referralList: '/monetization/referrals/list',
  },

  campaigns: {
    list: '/campaigns',
    create: '/campaigns',
    byId: (id: string) => `/campaigns/${id}`,
    estimate: '/campaigns/estimate',
    metrics: (id: string) => `/campaigns/${id}/metrics`,
    pause: (id: string) => `/campaigns/${id}/pause`,
  },

  verification: {
    status: '/verification',
    apply: '/verification',
  },

  reports: {
    create: '/reports',
  },

  support: {
    tickets: '/support/tickets',
    ticketById: (id: string) => `/support/tickets/${id}`,
    messages: (id: string) => `/support/tickets/${id}/messages`,
  },
} as const;

/** Money routes. Each one requires an `Idempotency-Key` header (ADR-013). */
export const IDEMPOTENT_ROUTES: readonly string[] = [
  ROUTES.wallet.purchases,
  ROUTES.wallet.withdrawals,
  ROUTES.wallet.convertReward,
  ROUTES.gifts.send,
  ROUTES.campaigns.create,
  '/monetization/tasks/:id/claim',
];

/** Socket.IO event names, shared so client and server cannot disagree. */
export const SOCKET_EVENTS = {
  connected: 'connected',
  messageNew: 'message:new',
  messageRead: 'message:read',
  messageDelivered: 'message:delivered',
  messageDeleted: 'message:deleted',
  chatCreated: 'chat:created',
  chatUpdated: 'chat:updated',
  chatJoin: 'chat:join',
  chatLeave: 'chat:leave',
  typing: 'chat:typing',
  presence: 'user:presence',
  notification: 'notification:new',
  liveEvent: 'live:event',
  liveJoin: 'live:join',
  liveLeave: 'live:leave',
  callOffer: 'call:offer',
  callAnswer: 'call:answer',
  callIce: 'call:ice',
  callEnd: 'call:end',
  callRinging: 'call:ringing',
  callState: 'call:state',
  walletUpdated: 'wallet:updated',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

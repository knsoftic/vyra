/**
 * Backend client for the admin panel.
 *
 * Authentication is the platform's own: an admin signs in with their normal
 * account through `/auth/login`, and what makes them an admin is the
 * `admin_users` row the backend resolves on every `/admin/*` request. There is
 * no separate admin token to leak — disabling the admin row ends the access.
 *
 * Tokens live in localStorage under one key. The access token is short-lived;
 * a 401 triggers one silent refresh and a retry, and a refresh that fails
 * clears the session and sends the operator back to the login page. That is
 * the entire session model, stated once, here.
 *
 * Like the mobile client, this distinguishes *offline* from *error*: a page
 * that cannot reach the backend should say so and keep rendering, not collapse.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const API = `${API_BASE}/api/v1`;
const TOKEN_KEY = 'vyra_admin_tokens';

export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly offline: boolean;

  constructor(code: string, message: string, status = 0, offline = false) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
    this.offline = offline;
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function readTokens(): Tokens | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: Tokens | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (tokens) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage full or blocked — the session just will not survive a reload.
  }
}

export function hasSession(): boolean {
  return readTokens() !== null;
}

/** Set by the layout so a dead session can route to /login from anywhere. */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

async function rawRequest<T>(path: string, init: RequestInit, token?: string): Promise<Envelope<T> & { status: number }> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new AdminApiError('offline', 'Could not reach the API.', 0, true);
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new AdminApiError('bad_response', `Unreadable response (${response.status}).`, response.status);
  }
  return { ...body, status: response.status };
}

/**
 * Single-flight refresh.
 *
 * A page load fires many requests at once; when the access token has just
 * expired they all 401 together. Refresh tokens rotate on use, so if each
 * request refreshed independently the first would win and every other would
 * present the now-dead token, fail, and clear the session — an operator signed
 * out by their own dashboard. One refresh runs; everyone else awaits it.
 */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const tokens = readTokens();
      if (!tokens) return false;
      const result = await rawRequest<Tokens>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => null);

      if (result?.ok && result.data?.accessToken) {
        storeTokens({ accessToken: result.data.accessToken, refreshToken: result.data.refreshToken });
        return true;
      }
      return false;
    } finally {
      // Cleared after settling so the NEXT expiry can refresh again.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const tokens = readTokens();
  const result = await rawRequest<T>(path, init, tokens?.accessToken);

  if (result.status === 401 && !retried) {
    if (await tryRefresh()) return request<T>(path, init, true);
    storeTokens(null);
    onSessionLost?.();
  }

  if (result.status < 400 && result.ok && result.data !== undefined) return result.data;
  throw new AdminApiError(
    result.error?.code ?? 'internal_error',
    result.error?.message ?? 'Request failed.',
    result.status,
  );
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

// ── Session ──

export interface AdminIdentity {
  adminId: number;
  name: string;
  role: string;
  permissions: string[];
}

export async function signIn(email: string, password: string): Promise<AdminIdentity> {
  const login = await rawRequest<{ tokens: Tokens }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      device: { deviceId: `admin-panel-${email.slice(0, 8)}`, platform: 'web' },
    }),
  });
  if (!login.ok || !login.data) {
    throw new AdminApiError(login.error?.code ?? 'unauthenticated', login.error?.message ?? 'Sign-in failed.', login.status);
  }
  storeTokens(login.data.tokens);

  // The account exists — but is it an admin? Asked before anything renders, so
  // a non-admin sees one clear sentence instead of 30 modules of 403s.
  try {
    return await get<AdminIdentity>('/admin/me');
  } catch (err) {
    storeTokens(null);
    if (err instanceof AdminApiError && err.status === 403) {
      throw new AdminApiError('forbidden', 'This account has no admin access.', 403);
    }
    throw err;
  }
}

export function signOut(): void {
  storeTokens(null);
}

// ── Health (unauthenticated, uses the bare host) ──

export interface LiveHealth {
  status: string;
  uptimeSeconds: number;
  version: string;
}

export interface LiveReadiness {
  ready: boolean;
  checks: Record<string, 'up' | 'down'>;
}

async function healthRequest<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  } catch {
    throw new AdminApiError('offline', 'Could not reach the API.', 0, true);
  }
  try {
    const body = (await response.json()) as Envelope<T>;
    if (body.ok && body.data) return body.data;
    throw new AdminApiError('bad_response', 'Malformed response.', response.status);
  } catch (err) {
    if (err instanceof AdminApiError) throw err;
    throw new AdminApiError('bad_response', 'Unreadable response.', response.status);
  }
}

export const backend = {
  health: () => healthRequest<LiveHealth>('/health'),
  readiness: () => healthRequest<LiveReadiness>('/ready'),
};

// ── The admin surface ──

export const adminApi = {
  me: () => get<AdminIdentity>('/admin/me'),
  dashboard: () => get<Record<string, never> & DashboardData>('/admin/dashboard'),
  analytics: () => get<AnalyticsData>('/admin/analytics'),
  audit: () => get<AuditRow[]>('/admin/audit'),
  security: () => get<{ events: SecurityEvent[]; adminLogins: AdminLogin[] }>('/admin/security'),

  users: (params: { q?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.status) search.set('status', params.status);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return get<{ items: AdminUserRow[]; total: number }>(`/admin/users${qs ? `?${qs}` : ''}`);
  },
  user: (id: string) => get<AdminUserDetail>(`/admin/users/${id}`),

  videos: (params: { q?: string; status?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.status) search.set('status', params.status);
    const qs = search.toString();
    return get<{ items: AdminVideoRow[] }>(`/admin/videos${qs ? `?${qs}` : ''}`);
  },
  comments: (q?: string) => get<{ items: AdminCommentRow[] }>(`/admin/comments${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  list: <T = CatalogueRow>(path: string) => get<{ items: T[] }>(`/admin/${path}`),
  update: (path: string, id: string | number, changes: Record<string, string | number | boolean>) =>
    patch<{ saved: true }>(`/admin/${path}/${id}`, { changes }),

  settings: () => get<{ settings: Record<string, unknown> }>('/admin/settings'),
  saveSetting: (key: string, value: unknown) => patch<{ saved: true }>('/admin/settings', { key, value }),
  emailStatus: () => get<EmailStatus>('/admin/settings/email/status'),
  emailTest: (to: string) => post<{ sent: boolean; detail?: string; transport?: string }>('/admin/settings/email/test', { to }),

  roles: () => get<RolesData>('/admin/roles'),
  grantAdmin: (email: string, name: string, roleSlug: string) =>
    post<{ granted: true }>('/admin/roles/admins', { email, name, roleSlug }),
  setAdminStatus: (id: string, status: 'active' | 'disabled') =>
    patch<{ status: string }>(`/admin/roles/admins/${id}`, { status }),

  outbox: () => get<OutboxStatus>('/admin/outbox'),
  drainOutbox: () => post<{ sent: number; failed: number; abandoned: number; transport: string }>('/admin/outbox/drain'),

  notificationCampaigns: () => get<{ items: NotificationCampaign[] }>('/admin/notification-campaigns'),
  sendCampaign: (title: string, body: string) =>
    post<{ id: number; recipients: number }>('/admin/notification-campaigns', { title, body }),

  createBanner: (banner: { title: string; subtitle?: string; placement: string; ctaLabel?: string; ctaUrl?: string }) =>
    post<{ id: number }>('/admin/banners', banner),
  setBannerStatus: (id: number, status: string) => patch<{ saved: true }>(`/admin/banners/${id}`, { status }),
  createFlag: (flag: { flagKey: string; label: string; description?: string }) => post<{ created: true }>('/admin/flags', flag),

  verificationQueue: () => get<VerificationRow[]>('/admin/verification'),
  decideVerification: (id: string, decision: string, note?: string) =>
    post<unknown>(`/admin/verification/${id}`, { decision, ...(note ? { note } : {}) }),
  documentLink: (documentId: string) => get<{ url: string; expiresInSeconds: number }>(`/admin/verification/documents/${documentId}/view`),

  reports: () => get<ReportRow[]>('/admin/reports'),
  moderationLog: () => get<ModerationRow[]>('/admin/moderation'),
  decide: (input: { targetType: string; targetId: string; action: string; reason: string; reportId?: string; durationHours?: number }) =>
    post<{ enforced: string }>('/admin/moderation', input),
  revert: (actionId: string, reason: string) => post<unknown>(`/admin/moderation/${actionId}/revert`, { reason }),

  tickets: (status?: string) => get<TicketRow[]>(`/admin/tickets${status ? `?status=${status}` : ''}`),
  ticket: (id: string) => get<TicketDetail>(`/admin/tickets/${id}`),
  replyTicket: (id: string, body: string, internal = false) =>
    post<unknown>(`/admin/tickets/${id}/reply`, { body, internal }),
  setTicketStatus: (id: string, status: string) => post<unknown>(`/admin/tickets/${id}/status`, { status }),

  purchases: () => get<PurchaseRow[]>('/admin/purchases'),
  decidePurchase: (id: string, approve: boolean, note: string) =>
    post<unknown>(`/admin/purchases/${id}`, { approve, note }),

  withdrawals: () => get<WithdrawalRow[]>('/admin/withdrawals'),
  decideWithdrawal: (id: string, action: 'approve' | 'pay' | 'reject', note: string, payoutRef?: string) =>
    post<unknown>(`/admin/withdrawals/${id}`, { action, note, ...(payoutRef ? { payoutRef } : {}) }),

  campaigns: () => get<CampaignRow[]>('/admin/campaigns'),
  reviewCampaign: (id: string, approve: boolean, note?: string) =>
    post<unknown>(`/admin/campaigns/${id}`, { approve, ...(note ? { note } : {}) }),

  rankingWeights: () => get<RankingWeight[]>('/admin/ranking/weights'),
  saveWeight: (key: string, value: number, reason: string) =>
    patch<unknown>(`/admin/ranking/weights/${key}`, { value, reason }),
  rankingStatus: () => get<Record<string, unknown>>('/admin/ranking/status'),

  models: () => get<{ models: ModelRow[]; experiments: ExperimentRow[] }>('/admin/models'),
  stopLive: (id: string, reason: string) => post<unknown>(`/admin/live/${id}/stop`, { reason }),
};

// ── Shapes (what the routes actually return) ──

export interface DashboardData {
  users: number;
  activeToday: number;
  signupsWeek: number;
  videos: number;
  videosToday: number;
  liveNow: number;
  queues: { reports: number; verification: number; coinRequests: number; withdrawals: number; support: number; campaigns: number };
  money: { coinsSoldWeek: number; giftCoinsWeek: number };
}

export interface AnalyticsPoint { day: string; value: number }
export interface AnalyticsData {
  signups: AnalyticsPoint[];
  videos: AnalyticsPoint[];
  watchMinutes: AnalyticsPoint[];
  giftCoins: AnalyticsPoint[];
}

export interface AuditRow {
  id: number; adminName: string; roleSlug: string; module: string; action: string;
  targetType: string | null; targetId: string | null; oldValue: string | null; newValue: string | null;
  reason: string | null; createdAt: string;
}

export interface SecurityEvent { id: number; event: string; outcome: string; detail: string | null; username: string | null; ip: string | null; createdAt: string }
export interface AdminLogin { id: number; email: string; outcome: string; device: string | null; ip: string | null; createdAt: string }

export interface AdminUserRow {
  id: string; username: string; email: string; status: string; category: string; verified: string;
  joinedAt: string; lastActiveAt: string | null; name: string | null; avatar: string | null;
  videos: number; followers: number; openReports: number;
}

export interface AdminUserDetail extends Record<string, unknown> {
  publicId: string; username: string; email: string; status: string; name: string | null;
  wallet: Record<string, unknown> | null;
  counts: Record<string, number> | null;
  moderation: { id: string; action: string; reason: string; status: string; createdAt: string }[];
}

export interface AdminVideoRow {
  id: string; caption: string | null; status: string; privacy: string; durationSec: number;
  views: number; likes: number; comments: number; createdAt: string; publishedAt: string | null;
  username: string; userId: string; openReports: number;
}

export interface AdminCommentRow {
  id: string; body: string; status: string; likes: number; createdAt: string;
  username: string; videoId: string; videoCaption: string | null; openReports: number;
}

export type CatalogueRow = Record<string, unknown> & { id?: number | string };

export interface EmailStatus {
  transport: 'smtp' | 'console';
  source?: 'settings' | 'environment';
  host?: string; port?: number; user?: string; from?: string;
}

export interface RolesData {
  roles: { id: number; slug: string; name: string; isSystem: number }[];
  permissions: { roleId: number; module: string; action: string }[];
  admins: { id: string; name: string; email: string; status: string; role: string; lastLoginAt: string | null; createdAt: string; username: string | null }[];
}

export interface OutboxStatus { pending: number; failed: number; abandoned: number; oldestPendingAgeSeconds: number | null; transport: string }
export interface NotificationCampaign { id: number; title: string; body: string; audience: string; status: string; scheduledAt: string | null; sentCount: number; createdAt: string }

export interface VerificationRow extends Record<string, unknown> { id: string; status: string }
export interface ReportRow extends Record<string, unknown> { id: string; status: string }
export interface ModerationRow extends Record<string, unknown> { id: string; action: string; status: string }
export interface TicketRow extends Record<string, unknown> { id: string; subject: string; status: string }
export interface TicketDetail extends Record<string, unknown> { id: string; messages?: unknown[] }
export interface PurchaseRow {
  id: string; username: string; coins: number; fiatAmount: number; fiatCurrency: string;
  quotedRate: number; method: string; transactionRef: string; status: string;
  decisionNote?: string; createdAt: string;
}
export interface WithdrawalRow {
  id: string; username: string; amount: number; fee: number; netAmount: number; currency: string;
  method?: string; destination?: string; destinationFull?: string; status: string;
  decisionNote?: string; payoutRef?: string; createdAt: string;
}
export interface CampaignRow extends Record<string, unknown> { id: string; status: string }
export interface RankingWeight extends Record<string, unknown> { key: string; value: number }
export interface ModelRow extends Record<string, unknown> { id: number; version: string; status: string }
export interface ExperimentRow extends Record<string, unknown> { id: number; experimentId: string; status: string }

/**
 * The three states a live panel can be in.
 *
 * `unknown` is not an error state — it is what an operator sees before the
 * first load completes, and conflating it with "down" would produce false
 * alarms.
 */
export type LiveState<T> =
  | { status: 'unknown' }
  | { status: 'live'; data: T }
  | { status: 'offline'; message: string };

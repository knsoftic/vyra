/**
 * API client.
 *
 * One place that knows how to talk to the backend: the base URL, the token, the
 * response envelope, and what to do when the access token expires.
 *
 * Three decisions worth stating:
 *
 * **The envelope is unwrapped here.** Every response is `{ok, data}` or
 * `{ok, error}` (shared/contracts/http.ts). Screens receive `data` or a thrown
 * `ApiError` — they never branch on `ok` themselves.
 *
 * **Refresh happens once, transparently.** A 401 with `token_expired` triggers a
 * single refresh and one retry. Concurrent requests share that one refresh
 * rather than each starting their own, which would rotate the token out from
 * under each other.
 *
 * **Offline is a distinct state, not an error.** A dead backend surfaces as
 * `ApiError.offline`, so the UI can fall back to sample data and say so, rather
 * than showing a failure the user cannot act on.
 */

import { Platform } from 'react-native';

/** Where the API lives. Overridable so a device can point at a laptop's LAN IP. */
const DEFAULT_BASE =
  Platform.OS === 'web' ? 'http://localhost:4000' : 'http://10.0.2.2:4000';

export const API_BASE =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? DEFAULT_BASE;

const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  /** True when the backend could not be reached at all. */
  readonly offline: boolean;

  constructor(
    code: string,
    message: string,
    status = 0,
    details?: Record<string, string[]>,
    offline = false,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (details) this.details = details;
    this.offline = offline;
  }

  /** The first field-level message, for showing under an input. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, string[]> };
  meta?: {
    hasMore: boolean;
    nextCursor?: string;
    /** True when the server narrowed the list on purpose (ADR-014). */
    restricted?: boolean;
  };
}

// ── Token storage ──

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

let tokens: Tokens | null = null;
let onUnauthenticated: (() => void) | null = null;

/**
 * Persistence.
 *
 * `localStorage` on web; in-memory on native until Phase 13 adds secure
 * storage. Tokens deliberately do not go to `AsyncStorage` on native — a refresh
 * token in unencrypted app storage is worth protecting properly rather than
 * conveniently.
 */
const STORAGE_KEY = 'vyra.tokens';

function persist(next: Tokens | null): void {
  tokens = next;
  if (Platform.OS !== 'web') return;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A private window or blocked storage: the session simply does not survive
    // a reload, which is acceptable.
  }
}

function restore(): void {
  if (Platform.OS !== 'web') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) tokens = JSON.parse(raw) as Tokens;
  } catch {
    tokens = null;
  }
}
restore();

export const setTokens = (next: Tokens | null): void => persist(next);
export const getAccessToken = (): string | null => tokens?.accessToken ?? null;
export const isAuthenticated = (): boolean => tokens !== null;

/** Called when a refresh fails and the session is genuinely over. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

// ── Refresh ──

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the access token.
 *
 * Concurrent callers share one attempt. Without that, several requests failing
 * at once would each rotate the refresh token, and every rotation but the first
 * would be treated by the server as token reuse — which revokes the whole
 * session family.
 */
async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  if (!tokens?.refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens!.refreshToken }),
      });
      const body = (await response.json()) as Envelope<Tokens>;
      if (!response.ok || !body.ok || !body.data) {
        persist(null);
        onUnauthenticated?.();
        return false;
      }
      persist({ accessToken: body.data.accessToken, refreshToken: body.data.refreshToken });
      return true;
    } catch {
      // A network failure is not an expired session — keep the tokens.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ── Requests ──

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Send without a token even if one is held. */
  anonymous?: boolean;
  signal?: AbortSignal;
  /**
   * Extra headers. Used for `Idempotency-Key` on money routes, where the same
   * key must be sent on every retry of one intent.
   */
  headers?: Record<string, string>;
}

interface Result<T> {
  data: T;
  meta?: Envelope<T>['meta'];
}

async function send<T>(path: string, options: RequestOptions, retrying = false): Promise<Result<T>> {
  const url = `${API_BASE}${path.startsWith('/api') ? '' : API_PREFIX}${path}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (!options.anonymous && tokens?.accessToken) {
    headers.authorization = `Bearer ${tokens.accessToken}`;
  }

  // Caller headers last so a retry carries the same idempotency key it was
  // given, rather than one this layer invented.
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers[name] = value;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiError(
      'offline',
      'Could not reach the server. Check that the backend is running.',
      0,
      undefined,
      true,
    );
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError('bad_response', `The server returned an unreadable response (${response.status}).`, response.status);
  }

  if (response.ok && body.ok && body.data !== undefined) {
    return { data: body.data, ...(body.meta ? { meta: body.meta } : {}) };
  }

  const code = body.error?.code ?? 'internal_error';
  const message = body.error?.message ?? 'Something went wrong.';

  // One transparent refresh, then give up.
  if (response.status === 401 && !retrying && !options.anonymous) {
    if (code === 'token_expired' || code === 'token_invalid') {
      const refreshed = await refreshTokens();
      if (refreshed) return send<T>(path, options, true);
      persist(null);
      onUnauthenticated?.();
    }
  }

  throw new ApiError(code, message, response.status, body.error?.details);
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    send<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    send<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    send<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    send<T>(path, { ...options, method: 'DELETE' }),
};

/** Liveness check, used to decide between live data and the sample fallback. */
export async function ping(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

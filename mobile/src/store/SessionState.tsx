/**
 * The real session.
 *
 * Replaces the Phase 1 placeholder in `AppState` with an account that actually
 * exists on the server. Kept as its own provider rather than folded into
 * `AppState` because the two have different lifetimes: the compose draft is
 * local and ephemeral, the session is remote and shared.
 *
 * The `backendStatus` flag is the important part. Every screen needs to
 * distinguish three states, not two:
 *
 *   `checking`  we do not know yet — show nothing rather than the wrong thing
 *   `live`      the API answered; show real data
 *   `offline`   the API did not answer; show sample data and say so
 *
 * Collapsing offline into an error would leave the app blank whenever the
 * backend is not running, which makes the UI impossible to work on. Collapsing
 * it into success would silently present sample data as real, which is worse.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import {
  auth as authApi,
  me as meApi,
  ping,
  isAuthenticated as hasTokens,
  restoreTokens,
  setTokens,
  setUnauthenticatedHandler,
  ApiError,
} from '../api';
import type { PrivateUser } from '../../../shared/contracts/user';

export type BackendStatus = 'checking' | 'live' | 'offline';

interface SessionValue {
  backendStatus: BackendStatus;
  /** True once a real account is signed in. */
  isSignedIn: boolean;
  /**
   * True until the stored session has been read back from secure storage.
   * The app must not route to the login screen while this is true.
   */
  restoring: boolean;
  user: PrivateUser | null;
  loading: boolean;
  error: string | null;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    username: string;
    displayName?: string;
    birthdate: string;
  }) => Promise<void>;
  /** Sends a one-time code to a phone number. */
  requestPhoneCode: (phone: string) => Promise<{ sent: boolean; phone: string; devCode?: string }>;
  /** Verifies the code and signs in — creating the account if the number is new. */
  verifyPhoneCode: (phone: string, code: string) => Promise<{ isNewAccount: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  recheckBackend: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * A stable per-install identifier.
 *
 * Not an advertising id and never used for targeting — it exists so a user can
 * see "signed in on this device" and revoke that one session (ADR-008).
 */
function deviceId(): string {
  const KEY = 'vyra.deviceId';
  if (Platform.OS === 'web') {
    try {
      const existing = localStorage.getItem(KEY);
      if (existing) return existing;
      const fresh = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(KEY, fresh);
      return fresh;
    } catch {
      // Storage blocked: a per-session id is still better than none.
    }
  }
  return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

const DEVICE = {
  deviceId: deviceId(),
  platform: (Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web') as
    | 'ios'
    | 'android'
    | 'web',
  appVersion: '0.8.0',
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [user, setUser] = useState<PrivateUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recheckBackend = useCallback(async () => {
    setBackendStatus('checking');
    const alive = await ping();
    setBackendStatus(alive ? 'live' : 'offline');
  }, []);

  /**
   * On boot: is the backend there, and is the stored session still valid?
   *
   * A stored token that the server rejects means the session ended elsewhere —
   * a password change, a revoked device — so it is cleared rather than retried.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // The stored session is read before anything else. Until this resolves
      // the app does not know whether anyone is signed in, and showing the
      // login screen in the meantime is indistinguishable from having been
      // logged out.
      const [alive] = await Promise.all([ping(), restoreTokens()]);
      if (cancelled) return;

      setBackendStatus(alive ? 'live' : 'offline');
      if (!alive || !hasTokens()) {
        setRestoring(false);
        return;
      }

      try {
        const profile = await meApi.profile();
        if (!cancelled) setUser(profile);
      } catch (err) {
        if (cancelled) return;
        // Only a rejected session clears the tokens. A network blip must not —
        // otherwise a moment without signal would sign someone out for good.
        if (err instanceof ApiError && !err.offline) setTokens(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // When a refresh finally fails, drop straight back to signed-out.
  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
    return () => setUnauthenticatedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const session = await authApi.login({ email, password, device: DEVICE });
      setUser(session.user);
      setBackendStatus('live');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.offline
            ? 'Could not reach the server. Is the backend running?'
            : err.message
          : 'Sign in failed.';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signUp = useCallback(
    async (input: {
      email: string;
      password: string;
      username: string;
      displayName?: string;
      birthdate: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const session = await authApi.register({ ...input, device: DEVICE });
        setUser(session.user);
        setBackendStatus('live');
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.offline
              ? 'Could not reach the server. Is the backend running?'
              : err.message
            : 'Sign up failed.';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const requestPhoneCode = useCallback(async (phone: string) => {
    setLoading(true);
    setError(null);
    try {
      return await authApi.requestPhoneOtp(phone);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.offline
            ? 'Could not reach the server. Is the backend running?'
            : err.message
          : 'Could not send the code.';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyPhoneCode = useCallback(async (phone: string, code: string) => {
    setLoading(true);
    setError(null);
    try {
      const session = await authApi.verifyPhone({ phone, code, device: DEVICE });
      setUser(session.user);
      setBackendStatus('live');
      return { isNewAccount: session.isNewAccount };
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.offline
            ? 'Could not reach the server. Is the backend running?'
            : err.message
          : 'That code did not work.';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
    setError(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!hasTokens()) return;
    try {
      setUser(await meApi.profile());
    } catch {
      // Leave the cached profile in place; a stale name beats a blank screen.
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      backendStatus,
      isSignedIn: user !== null,
      restoring,
      user,
      loading,
      error,
      signIn,
      signUp,
      requestPhoneCode,
      verifyPhoneCode,
      signOut,
      refreshProfile,
      recheckBackend,
    }),
    [
      backendStatus, restoring, user, loading, error, signIn, signUp,
      requestPhoneCode, verifyPhoneCode, signOut, refreshProfile, recheckBackend,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

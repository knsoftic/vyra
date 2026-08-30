'use client';

/**
 * The admin session, held once.
 *
 * The dashboard layout wraps everything in this provider: it checks the stored
 * tokens against `/admin/me`, routes to /login when there is no session worth
 * having, and exposes who is signed in plus the live queue counts the sidebar
 * badges show. Every page reads from here instead of asking again.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminApi,
  hasSession,
  signOut as apiSignOut,
  setSessionLostHandler,
  type AdminIdentity,
  type DashboardData,
} from './api';

interface SessionState {
  identity: AdminIdentity | null;
  /** Live queue depths for the sidebar badges; null until the first load. */
  queues: DashboardData['queues'] | null;
  checking: boolean;
  refreshQueues: () => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionState>({
  identity: null,
  queues: null,
  checking: true,
  refreshQueues: () => {},
  signOut: () => {},
});

export function useAdminSession(): SessionState {
  return useContext(SessionContext);
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [queues, setQueues] = useState<DashboardData['queues'] | null>(null);
  const [checking, setChecking] = useState(true);

  const signOut = useCallback(() => {
    apiSignOut();
    router.replace('/login');
  }, [router]);

  const refreshQueues = useCallback(() => {
    adminApi
      .dashboard()
      .then((d) => setQueues(d.queues))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => router.replace('/login'));
    return () => setSessionLostHandler(null);
  }, [router]);

  useEffect(() => {
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    adminApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setIdentity(me);
        setChecking(false);
        refreshQueues();
      })
      .catch(() => {
        if (cancelled) return;
        apiSignOut();
        router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router, refreshQueues]);

  // A session check in flight renders nothing rather than a flash of an
  // admin panel someone may turn out not to be allowed to see.
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-muted text-sm">
        Checking session…
      </div>
    );
  }

  return (
    <SessionContext.Provider value={{ identity, queues, checking, refreshQueues, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

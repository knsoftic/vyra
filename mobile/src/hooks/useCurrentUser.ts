/**
 * Who the app should say you are.
 *
 * Screens were reading the signed-in account from two different places: the
 * profile from the session, everything else from the sample store. The result
 * was a Settings page greeting one person while the profile tab showed another
 * — the same account described two ways, which is worse than either alone.
 *
 * This is the single answer: the real account when there is one, the sample
 * account when there is not, and a flag saying which, so a screen that needs to
 * behave differently can.
 */

import { useMemo } from 'react';
import { useApp } from '../store/AppState';
import { useSession } from '../store/SessionState';
import { toUser } from '../api';
import type { User } from '../types';

export interface CurrentUser {
  user: User;
  /** True when this is a real signed-in account rather than the sample one. */
  live: boolean;
}

export function useCurrentUser(): CurrentUser {
  const { user: sampleUser } = useApp();
  const { user: sessionUser } = useSession();

  return useMemo(() => {
    if (!sessionUser) return { user: sampleUser, live: false };

    // The sample user is the base so nothing the server does not send goes
    // missing from the interface; every field the server does send wins.
    return { user: { ...sampleUser, ...toUser(sessionUser) }, live: true };
  }, [sampleUser, sessionUser]);
}

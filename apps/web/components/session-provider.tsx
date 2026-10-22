'use client';

import type { UserSummary } from '@ticketdesk/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { sessionRequest, type ApiResult } from '../lib/api';

interface SessionState {
  /** Null until `/me` resolves, and null when the caller is signed out. */
  user: UserSummary | null;
  /** True once `/me` has answered, whichever way it went. */
  known: boolean;
}

const SessionContext = createContext<SessionState>({ user: null, known: false });

// One request per hard page load, even when React re-runs the effect in
// development. A hard navigation reloads this module, so sign-in and sign-out
// each get a fresh answer; client-side routing deliberately does not refetch.
let meRequest: Promise<ApiResult<UserSummary>> | undefined;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ user: null, known: false });

  useEffect(() => {
    // Signing out deletes the row this request would resolve; the page
    // navigates on its own, so asking here would only race it.
    if (window.location.pathname === '/logout') {
      return;
    }

    let active = true;
    meRequest ??= sessionRequest<UserSummary>('/api/auth/me');

    void meRequest.then((result) => {
      if (!active) {
        return;
      }

      setSession({ user: result.ok ? result.data : null, known: true });
    });

    return () => {
      active = false;
    };
  }, []);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

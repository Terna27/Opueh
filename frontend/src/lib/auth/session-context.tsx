"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { User } from "@/lib/api/types";

import { fetchSession, type SessionState } from "./client";

/*
 * The session, as the browser knows it.
 *
 * Hydrated from `/api/auth/me` on mount rather than rendered on the server.
 * That is a deliberate trade: a server-rendered header would make every page
 * dynamic and put an upstream call in the path of a marketing page that is
 * otherwise entirely static. The cost is one request after load, during which
 * the header shows a placeholder rather than guessing.
 *
 * The guess would be the worse option. Assuming "signed out" flashes a Log in
 * button at someone who is signed in, which reads as having been logged out.
 */

export type SessionContextValue = {
  session: SessionState;
  /** Adopt the user returned by a successful login or register. */
  adoptUser: (user: User) => void;
  /** Drop the session locally, after a logout or a rejected refresh. */
  forgetUser: (notice?: string) => void;
  /** Ask again — for retrying after the API was unreachable. */
  refresh: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  // Bumped to re-run the fetch. A counter rather than a boolean so repeated
  // retries each take effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A navigation or a re-render can happen before this resolves, and a late
    // answer must not overwrite a newer one.
    let current = true;

    void fetchSession().then((next) => {
      if (current) setSession(next);
    });

    return () => {
      current = false;
    };
  }, [attempt]);

  const adoptUser = useCallback((user: User) => {
    setSession({ status: "signed-in", user });
  }, []);

  const forgetUser = useCallback((notice?: string) => {
    setSession({ status: "signed-out", notice });
  }, []);

  const refresh = useCallback(() => {
    setSession({ status: "loading" });
    setAttempt((previous) => previous + 1);
  }, []);

  const value = useMemo(
    () => ({ session, adoptUser, forgetUser, refresh }),
    [session, adoptUser, forgetUser, refresh],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside a SessionProvider.");
  }
  return value;
}

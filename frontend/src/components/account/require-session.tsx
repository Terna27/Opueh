"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { ErrorState } from "@/components/ui/error-state";
import { Spinner } from "@/components/ui/spinner";
import { loginHrefWithNext } from "@/lib/account/next-param";
import { useSession } from "@/lib/auth/session-context";

/*
 * The real guard for authenticated pages.
 *
 * Middleware answers a cheaper question first — is any session cookie present?
 * — but it runs before the request reaches the app and cannot verify a token,
 * so it is optimistic by construction. This is where the actual answer comes
 * from: the session state the app already maintains, which the Go API has
 * confirmed. A stale or forged cookie gets past proxy.ts and is refused here.
 *
 * The three states are kept genuinely distinct, following `AuthNav`:
 *
 *   loading     — a placeholder, never a redirect. Redirecting before the
 *                 answer arrives would bounce a signed-in user to the login
 *                 page on every hard refresh.
 *   unavailable — an error with a retry, and explicitly NOT a redirect. An
 *                 unreachable API says nothing about the session, and treating
 *                 it as signed-out would log people out whenever Opueh
 *                 hiccups.
 *   signed-out  — redirect to the login page, carrying where they were going.
 */

export function RequireSession({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const signedOut = session.status === "signed-out";

  useEffect(() => {
    if (!signedOut) return;

    // `replace`, not `push`: the protected URL should not be left in history
    // for the back button to return to once the user has been bounced off it.
    router.replace(loginHrefWithNext(pathname));
  }, [signedOut, pathname, router]);

  if (session.status === "unavailable") {
    return (
      <ErrorState
        title="Opueh is temporarily unavailable"
        description={session.message}
        onRetry={refresh}
      />
    );
  }

  if (session.status !== "signed-in") {
    // Loading, or signed-out with the redirect already in flight. Both render
    // the same placeholder rather than flashing a login form at someone who is
    // signed in.
    return (
      <div className="flex min-h-[24rem] items-center justify-center">
        <Spinner size="lg" label="Loading your account" />
      </div>
    );
  }

  return <>{children}</>;
}

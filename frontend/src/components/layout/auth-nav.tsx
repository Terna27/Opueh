"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { logoutRequest } from "@/lib/auth/client";
import { useSession } from "@/lib/auth/session-context";

/*
 * The header's session controls.
 *
 * A Client Component, because it is the one part of the header that depends on
 * something the server cannot know at build time. The rest of the header stays
 * server-rendered.
 *
 * The states are kept genuinely distinct. While the session is loading this
 * renders a placeholder rather than the signed-out buttons: guessing "signed
 * out" flashes a Log in button at someone who is signed in, which reads as
 * having been logged out. "Unavailable" is a third state again — an
 * unreachable API is not a statement about the session, so it offers a retry
 * rather than an invitation to log in.
 */
export function AuthNav() {
  const router = useRouter();
  const { session, forgetUser, refresh } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);

    const result = await logoutRequest();

    // The cookies are cleared server-side on every outcome, so the browser is
    // signed out either way. A failure only means the server's copy may still
    // be alive, and that is what the notice says.
    forgetUser(result.ok ? undefined : result.error.message);

    setLoggingOut(false);
    router.refresh();
  }

  if (session.status === "loading") {
    return (
      <span
        aria-hidden="true"
        // Fixed size so the header does not shift when this resolves.
        className="block h-8 w-32 animate-pulse rounded-md bg-foreground/10"
      />
    );
  }

  if (session.status === "unavailable") {
    return (
      <span className="flex items-center gap-2">
        <span className="hidden text-xs text-muted sm:inline">
          Can&apos;t reach Opueh
        </span>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Retry
        </Button>
      </span>
    );
  }

  if (session.status === "signed-in") {
    return (
      <span className="flex items-center gap-2">
        {/*
          The username is the link to the public profile. `truncate` needs a
          width to truncate to, and the full name stays reachable through the
          title attribute for anyone whose name is cut short.
        */}
        <Link
          href={`/u/${session.user.username}`}
          title={`View @${session.user.username}'s profile`}
          className="max-w-24 truncate text-sm font-medium text-foreground hover:underline"
        >
          {session.user.username}
        </Link>
        <Link
          href="/settings/profile"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Settings
        </Link>
        <Button
          variant="ghost"
          size="sm"
          loading={loggingOut}
          onClick={handleLogout}
        >
          Log out
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      {/*
        A notice worth explaining: a logout that could not reach the API, or a
        session the backend ended on its own (a suspension). Without it the
        login form would keep rejecting the user with no explanation.
        Hidden on narrow screens, where there is no room for it.
      */}
      {session.notice ? (
        <span
          className="hidden max-w-48 truncate text-xs text-muted lg:inline"
          title={session.notice}
        >
          {session.notice}
        </span>
      ) : null}

      <Link
        href="/login"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Log in
      </Link>
      <Link
        href="/register"
        className={buttonVariants({ variant: "primary", size: "sm" })}
      >
        Sign up
      </Link>
    </span>
  );
}

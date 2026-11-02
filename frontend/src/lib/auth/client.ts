"use client";

import { ApiError, parseApiError } from "@/lib/api/errors";
import type { SessionUser, User } from "@/lib/api/types";

/*
 * The browser's view of the session.
 *
 * Every call here goes to this app's own /api/auth/* routes, never to the Go
 * API. That is the whole point of the proxy: the browser has no API origin, no
 * Bearer token, and no way to obtain either. It asks whether it is signed in
 * and is told yes or no.
 *
 * These are same-origin fetches, so the httpOnly cookies ride along without
 * anything being attached here, and nothing in this module can read them.
 */

export type SessionState =
  /** The first answer has not arrived yet. Not "signed out". */
  | { status: "loading" }
  | { status: "signed-in"; user: User }
  /** Carries a reason when the backend gave one worth showing, e.g. a suspension. */
  | { status: "signed-out"; notice?: string }
  /** The app could not reach its own API. Not a statement about the session. */
  | { status: "unavailable"; message: string };

export type AuthOutcome =
  | { ok: true; user: User }
  | { ok: false; error: ApiError };

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function offline(): ApiError {
  // Status 0 is the marker of "no HTTP response at all", which is what lets
  // the UI say "temporarily unavailable" instead of blaming the credentials.
  return ApiError.upstreamUnavailable();
}

/** Ask the proxy who, if anyone, is signed in. */
export async function fetchSession(): Promise<SessionState> {
  let response: Response;
  try {
    response = await fetch("/api/auth/me", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    // A network failure says nothing about whether the session is alive.
    return {
      status: "unavailable",
      message: "Could not reach Opueh. Check your connection and try again.",
    };
  }

  const body = await readBody(response);

  if (response.ok) {
    const payload = body as Partial<SessionUser> | undefined;
    if (!payload?.user) {
      return {
        status: "unavailable",
        message: "Opueh returned an unexpected response.",
      };
    }
    return { status: "signed-in", user: payload.user };
  }

  const error = parseApiError(response.status, body);

  if (error.status === 401 || error.status === 403) {
    // Signed out. A suspension or ban is worth saying out loud — the user
    // would otherwise be baffled by a login form that keeps rejecting them.
    const notice =
      error.code === "ACCOUNT_SUSPENDED" || error.code === "ACCOUNT_BANNED"
        ? error.message
        : undefined;
    return { status: "signed-out", notice };
  }

  return { status: "unavailable", message: error.message };
}

async function postCredentials(
  path: string,
  payload: Record<string, string>,
): Promise<AuthOutcome> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: offline() };
  }

  const body = await readBody(response);

  if (response.ok) {
    const parsed = body as Partial<SessionUser> | undefined;
    if (!parsed?.user) {
      return {
        ok: false,
        error: parseApiError(response.status, undefined),
      };
    }
    return { ok: true, user: parsed.user };
  }

  // The backend's own message is the contract and is shown as it is — the
  // proxy passes VALIDATION_ERROR through unchanged for exactly this reason.
  return { ok: false, error: parseApiError(response.status, body) };
}

export function loginRequest(
  identifier: string,
  password: string,
): Promise<AuthOutcome> {
  return postCredentials("/api/auth/login", { identifier, password });
}

export function registerRequest(input: {
  email: string;
  username: string;
  password: string;
  display_name: string;
}): Promise<AuthOutcome> {
  return postCredentials("/api/auth/register", input);
}

/**
 * End the session.
 *
 * The cookies are cleared server-side on every outcome, including a failure to
 * reach the API, so the browser is signed out either way. The return value
 * only says whether the server's copy was confirmed revoked.
 */
export async function logoutRequest(): Promise<
  { ok: true } | { ok: false; error: ApiError }
> {
  let response: Response;
  try {
    response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: offline() };
  }

  if (response.ok) return { ok: true };

  const body = await readBody(response);
  return { ok: false, error: parseApiError(response.status, body) };
}

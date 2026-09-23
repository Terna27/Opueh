import { cookies } from "next/headers";

import { performRefresh } from "./auth";
import { ApiError } from "./errors";
import { createRefreshCoordinator, type RefreshOutcome } from "./refresh";
import { assertServer } from "./server-only";

assertServer("src/lib/api/session.ts");

/*
 * Where the session lives.
 *
 * httpOnly, so no token is ever reachable from JavaScript. That is the whole
 * reason a server layer exists between the browser and the Go API — an XSS bug
 * can make requests as the user, but it cannot read or exfiltrate a token that
 * outlives the page.
 *
 * The cookie names change between environments because of the `__Host-`
 * prefix, which browsers only accept on a Secure cookie with `Path=/` and no
 * `Domain`. Given those constraints it makes the cookie impossible for a
 * sibling subdomain to overwrite — a real defence, and free. It is applied in
 * production only, because a local dev server over plain http could not set it.
 */
export const ACCESS_COOKIE_BASE = "opueh_access";
export const REFRESH_COOKIE_BASE = "opueh_refresh";

/*
 * How long the refresh cookie should live.
 *
 * The auth response carries `expires_in` for the ACCESS token but says nothing
 * about the refresh token, so this cannot be read from the API — it is a
 * mirror of the backend's default REFRESH_TOKEN_TTL (720h, see
 * internal/config/config.go) and is the one number here that is a guess.
 *
 * Being wrong is not a security problem, because the backend is the authority
 * on expiry and rejects a token that is stale whatever the browser thinks: a
 * cookie that outlives its token just fails and the session is cleared, and
 * one that dies early logs the user out sooner than necessary. Adding a
 * `refresh_expires_in` field to the auth response would make this exact and
 * remove the guess entirely.
 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export type CookieNames = {
  access: string;
  refresh: string;
};

/** The cookie names for the current environment. */
export function cookieNames(isProd: boolean = isProduction()): CookieNames {
  const prefix = isProd ? "__Host-" : "";
  return {
    access: `${prefix}${ACCESS_COOKIE_BASE}`,
    refresh: `${prefix}${REFRESH_COOKIE_BASE}`,
  };
}

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds, straight from the API's `expires_in`. */
  accessTokenMaxAge: number;
};

/**
 * The cookies a successful auth response should be stored as.
 *
 * Kept next to `SessionTokens` so the mapping from the API's snake_case
 * payload to the internal shape exists in one place, and a renamed field
 * upstream is a type error here rather than a silently empty cookie.
 */
export function tokensFromAuthResponse(response: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): SessionTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    accessTokenMaxAge: response.expires_in,
  };
}

export type SessionCookieWrite = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
};

function cookieOptions(isProd: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure: isProd,
    // "lax" keeps the cookies off cross-site POSTs, which is what makes a
    // plain form on another origin unable to drive an authenticated write.
    // It is the primary CSRF defence; the Origin check in the route handlers
    // is the second layer.
    sameSite: "lax",
    path: "/",
    maxAge,
  } as const;
}

/**
 * The cookies a successful register/login/refresh should set.
 *
 * The access cookie's lifetime comes from the API's own `expires_in` rather
 * than a hardcoded 15 minutes, so a deployment that retunes
 * ACCESS_TOKEN_TTL does not leave the browser holding a token it thinks is
 * still fresh.
 *
 * Pure, so the security attributes are testable without a request scope.
 */
export function sessionCookieWrites(
  tokens: SessionTokens,
  isProd: boolean = isProduction(),
): SessionCookieWrite[] {
  const names = cookieNames(isProd);
  return [
    {
      name: names.access,
      value: tokens.accessToken,
      options: cookieOptions(isProd, tokens.accessTokenMaxAge),
    },
    {
      name: names.refresh,
      value: tokens.refreshToken,
      options: cookieOptions(isProd, REFRESH_COOKIE_MAX_AGE_SECONDS),
    },
  ];
}

/**
 * The cookies that end a session.
 *
 * `maxAge: 0` expires them immediately. The name still has to match whatever
 * `cookieNames` produced, or the clear would silently miss and leave a live
 * refresh token in the browser.
 */
export function clearingCookieWrites(
  isProd: boolean = isProduction(),
): SessionCookieWrite[] {
  const names = cookieNames(isProd);
  return [names.access, names.refresh].map((name) => ({
    name,
    value: "",
    options: cookieOptions(isProd, 0),
  }));
}

/** Read both tokens from the incoming request. Null when absent. */
export async function readSessionCookies(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  const store = await cookies();
  const names = cookieNames();
  return {
    accessToken: store.get(names.access)?.value ?? null,
    refreshToken: store.get(names.refresh)?.value ?? null,
  };
}

/** Write the session cookies onto the outgoing response. */
export async function writeSessionCookies(
  tokens: SessionTokens,
): Promise<void> {
  const store = await cookies();
  for (const { name, value, options } of sessionCookieWrites(tokens)) {
    store.set(name, value, options);
  }
}

/** Expire both session cookies. */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const { name, value, options } of clearingCookieWrites()) {
    store.set(name, value, options);
  }
}

/*
 * One coordinator per server instance.
 *
 * Module scope is the point, not an accident: the duplicate refresh requests
 * that must be deduplicated arrive on DIFFERENT requests, so a coordinator
 * created per request would never see a duplicate and would protect nothing.
 *
 * This is exact for a single long-lived instance and best-effort across
 * several. That limitation is confined to this one line — a deployment needing
 * a shared lock swaps the coordinator for one backed by Redis or a database
 * and changes nothing else.
 */
const refreshCoordinator = createRefreshCoordinator(performRefresh);

/**
 * Refresh the current session and adopt whatever the outcome requires.
 *
 * This is the only path that rotates a refresh token, and it is deliberately
 * the only place cookies are written from an outcome, so the three cases stay
 * distinguishable:
 *
 * - refreshed   — store the new pair. The old refresh token is now consumed.
 * - session-over — the backend rejected the token, or the account may no
 *                  longer authenticate. Clear the cookies.
 * - unavailable — no verdict was reached. Clear NOTHING. An API that is down
 *                  or slow is not evidence that the session ended, and
 *                  signing someone out over a network blip is worse than the
 *                  blip. The caller reports it as a 503.
 */
export async function refreshSession(): Promise<RefreshOutcome> {
  const { refreshToken } = await readSessionCookies();

  if (!refreshToken) {
    return {
      status: "session-over",
      error: new ApiError(
        "UNAUTHENTICATED",
        "You are not signed in.",
        401,
      ),
    };
  }

  const outcome = await refreshCoordinator.refresh(refreshToken);

  if (outcome.status === "refreshed") {
    await writeSessionCookies(outcome.tokens);
  } else if (outcome.status === "session-over") {
    await clearSessionCookies();
  }

  return outcome;
}

import {
  apiFetch,
  requestUpstream,
  type RefreshOnce,
  type UpstreamResult,
} from "./client";
import { isSessionOver } from "./errors";
import type { RefreshOutcome } from "./refresh";
import { assertServer } from "./server-only";
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
} from "./types";

assertServer("src/lib/api/auth.ts");

/*
 * The Go API's auth endpoints, one function each.
 *
 * Paths are copied from internal/routes/routes.go and the JSON bodies from the
 * request structs in internal/handlers/auth.go. The handlers decode with
 * DisallowUnknownFields(), so each body is built field by field here rather
 * than forwarded from the browser: an extra key is a 400, and a body the
 * client controls is a body the client can add fields to.
 */

export function registerUser(
  input: RegisterRequest,
): Promise<UpstreamResult<AuthResponse>> {
  return requestUpstream<AuthResponse>({
    path: "/api/v1/auth/register",
    method: "POST",
    body: {
      email: input.email,
      username: input.username,
      password: input.password,
      display_name: input.display_name,
    },
  });
}

export function loginUser(
  input: LoginRequest,
): Promise<UpstreamResult<AuthResponse>> {
  return requestUpstream<AuthResponse>({
    path: "/api/v1/auth/login",
    method: "POST",
    body: {
      identifier: input.identifier,
      password: input.password,
    },
  });
}

/**
 * Exchange a refresh token for a new pair.
 *
 * No Bearer header: the refresh token IS the credential, and the backend
 * declares this route unauthenticated. Calling it consumes the token — see
 * `refresh.ts` for why it must never be issued twice or retried.
 */
export function requestTokenRefresh(
  refreshToken: string,
): Promise<UpstreamResult<AuthResponse>> {
  return requestUpstream<AuthResponse>({
    path: "/api/v1/auth/refresh",
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

/** Revoke the current session. Requires the access token. */
export function logoutSession(
  accessToken: string,
  refresh?: RefreshOnce,
): Promise<UpstreamResult<void>> {
  return apiFetch<void>(
    {
      path: "/api/v1/auth/logout",
      method: "POST",
      accessToken,
    },
    refresh,
  );
}

/**
 * The signed-in user, used to restore a session on page load.
 *
 * `/api/v1/me` answers with a bare user object — not the `{user: ...}` the
 * proxy hands the browser. The wrapper is added by the route handler, so the
 * two shapes are deliberately different types (`User` here, `SessionUser`
 * there) and cannot be confused for one another.
 *
 * Takes the refresh hook because this is the call an expired access cookie
 * shows up on, which is exactly the moment a silent refresh has to happen.
 */
export function fetchCurrentUser(
  accessToken: string,
  refresh?: RefreshOnce,
): Promise<UpstreamResult<User>> {
  return apiFetch<User>(
    {
      path: "/api/v1/me",
      method: "GET",
      accessToken,
    },
    refresh,
  );
}

/**
 * One refresh attempt, classified into the three outcomes the coordinator
 * distinguishes.
 *
 * The classification is the whole point: only a code the backend uses to mean
 * "this refresh token is not acceptable" ends the session. Anything else —
 * unreachable, timed out, a 500, a 502 from something in between — reached no
 * verdict, and `isSessionOver` excludes all of it. Collapsing the two would
 * log people out whenever the API hiccuped.
 */
export async function performRefresh(
  refreshToken: string,
): Promise<RefreshOutcome> {
  const result = await requestTokenRefresh(refreshToken);

  if (result.ok) {
    return {
      status: "refreshed",
      user: result.data.user,
      tokens: {
        accessToken: result.data.access_token,
        refreshToken: result.data.refresh_token,
        accessTokenMaxAge: result.data.expires_in,
      },
    };
  }

  return isSessionOver(result.error)
    ? { status: "session-over", error: result.error }
    : { status: "unavailable", error: result.error };
}

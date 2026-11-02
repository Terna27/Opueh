import { apiBaseUrl } from "./env";
import {
  ApiError,
  isAccessTokenRejected,
  parseApiError,
} from "./errors";
import type { RefreshOutcome } from "./refresh";
import { assertServer } from "./server-only";

assertServer("src/lib/api/client.ts");

/*
 * The transport between the proxy handlers and the Go API.
 *
 * Only the server can call this: the tokens it attaches are read from
 * httpOnly cookies, which browser code cannot see.
 */

/**
 * How long to wait for the API before giving up.
 *
 * Bounded because this call sits inside a page request; an API that never
 * answers must not hold a browser connection open indefinitely. On expiry the
 * request is abandoned, not retried — retrying is what replays a refresh
 * token. See finding 2 in the milestone plan.
 */
export const UPSTREAM_TIMEOUT_MS = 10_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type UpstreamRequest = {
  /** Path only, starting with "/", e.g. "/api/v1/auth/login". */
  path: string;
  method: HttpMethod;
  /**
   * Built explicitly by the caller, never forwarded from the browser. The Go
   * handlers use DisallowUnknownFields(), so a stray key is a 400 — and a body
   * the client controls is a body the client can add fields to.
   */
  body?: unknown;
  /** Bearer token for protected routes. */
  accessToken?: string | null;
};

export type UpstreamResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

/** JSON.parse that yields undefined instead of throwing on a non-JSON body. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One request to the Go API. No retrying of any kind happens here — every
 * retry decision belongs to `apiFetch`, which is the only place that knows
 * whether retrying is safe.
 */
export async function requestUpstream<T>(
  request: UpstreamRequest,
  options: { timeoutMs?: number } = {},
): Promise<UpstreamResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (request.accessToken) {
    headers.Authorization = `Bearer ${request.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${request.path}`, {
      method: request.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
      // Every one of these calls is per-request state, and Next would
      // otherwise be free to serve a cached body for a different user.
      cache: "no-store",
    });
  } catch {
    // Connection refused, DNS failure, or the timeout above. No HTTP response
    // exists, so there is no verdict about the request — which is why this
    // carries status 0 and is never read as "rejected".
    return { ok: false, error: ApiError.upstreamUnavailable() };
  }

  const text = await response.text();

  if (!response.ok) {
    // A body that is not the error envelope becomes MALFORMED_RESPONSE rather
    // than being coerced into one: an HTML 502 page from something in front of
    // the API must not be reported as though the API had said it.
    return {
      ok: false,
      error: parseApiError(response.status, parseJson(text)),
    };
  }

  // 204 (logout) has no body by definition.
  if (response.status === 204 || text.trim() === "") {
    return { ok: true, data: undefined as T };
  }

  const parsed = parseJson(text);
  if (parsed === undefined) {
    return { ok: false, error: ApiError.malformedResponse(response.status) };
  }

  return { ok: true, data: parsed as T };
}

/**
 * Perform a refresh and, on success, adopt the tokens it returned.
 *
 * Supplied by the caller because adopting tokens means writing cookies, which
 * needs the request scope. Returning the outcome (rather than a bare boolean)
 * is what lets `apiFetch` retry with the new access token and lets the caller
 * distinguish "session over" from "API unreachable".
 */
export type RefreshOnce = () => Promise<RefreshOutcome>;

/**
 * A request to the Go API that survives an expired access token.
 *
 * On a 401 the session is refreshed and the request is retried **exactly
 * once**. One retry is the whole budget: a second 401 means the freshly minted
 * access token was rejected too, which no amount of refreshing will fix.
 */
export async function apiFetch<T>(
  request: UpstreamRequest,
  refresh?: RefreshOnce,
  options: { timeoutMs?: number } = {},
): Promise<UpstreamResult<T>> {
  const first = await requestUpstream<T>(request, options);
  if (first.ok) {
    return first;
  }

  // Nothing to refresh with, or nothing to refresh: register/login/logout
  // carry no access token, and login's own 401 means the password was wrong,
  // not that a token expired. Only a 401 on a request that presented a token
  // can mean "expired".
  if (!request.accessToken || !refresh || !isAccessTokenRejected(first.error)) {
    return first;
  }

  const outcome = await refresh();

  if (outcome.status !== "refreshed") {
    // "session-over" and "unavailable" both surface unchanged, and they are
    // different statuses downstream: the first is the API's own 401/403, the
    // second a 503. Collapsing them here would sign the user out on a blip.
    return { ok: false, error: outcome.error };
  }

  return requestUpstream<T>(
    { ...request, accessToken: outcome.tokens.accessToken },
    options,
  );
}

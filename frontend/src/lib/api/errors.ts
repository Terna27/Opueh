/**
 * The API's error model.
 *
 * Every error the Go API returns has one shape (internal/apperr/apperr.go):
 *
 *   { "error": { "code": "INVALID_CREDENTIALS", "message": "..." } }
 *
 * The proxy handlers re-emit that same shape, so this module is shared by the
 * server and the browser and there is one parser rather than two.
 */

/**
 * Error codes the Go API produces. Copied from the `apperr.New` call sites;
 * `code` is documented as "stable and machine-readable", so branching on it is
 * the intended use.
 */
export type BackendErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN"
  | "UNAUTHENTICATED"
  | "INVALID_REFRESH_TOKEN"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_BANNED"
  | "EMAIL_ALREADY_EXISTS"
  | "USERNAME_ALREADY_EXISTS"
  | "RATE_LIMITED"
  | "REQUEST_TOO_LARGE"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL";

/**
 * Codes that exist only in this app — the situations the Go API cannot report
 * because it was never reached, or answered with something that is not its
 * error envelope.
 */
export type ClientErrorCode =
  | "UPSTREAM_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "FORBIDDEN_ORIGIN";

export type ApiErrorCode = BackendErrorCode | ClientErrorCode;

/**
 * Copy for the codes this app originates.
 *
 * The backend's own messages are documented as safe to display and are passed
 * through untouched. Rewording them here would create a second copy of every
 * message, free to drift from the one the API actually enforces.
 */
const CLIENT_ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  UPSTREAM_UNAVAILABLE:
    "Opueh is temporarily unavailable. Please try again in a moment.",
  MALFORMED_RESPONSE:
    "Opueh returned an unexpected response. Please try again.",
  FORBIDDEN_ORIGIN: "This request was blocked for security reasons.",
};

/** An error from the API, or from failing to reach it. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** The HTTP status, or 0 when no response was received at all. */
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }

  /** An error raised before any response existed — connection refused, DNS, timeout. */
  static upstreamUnavailable(): ApiError {
    return new ApiError(
      "UPSTREAM_UNAVAILABLE",
      CLIENT_ERROR_MESSAGES.UPSTREAM_UNAVAILABLE,
      0,
    );
  }

  /** A response arrived, but was not the documented error envelope. */
  static malformedResponse(status: number): ApiError {
    return new ApiError(
      "MALFORMED_RESPONSE",
      CLIENT_ERROR_MESSAGES.MALFORMED_RESPONSE,
      status,
    );
  }

  /**
   * A mutating request whose Origin was missing or did not match this site.
   *
   * Distinct from every backend code on purpose: this is a CSRF refusal, not
   * an authentication outcome, and a client that mistook it for one would
   * either clear a healthy session or start refreshing. It carries a real 403
   * so it passes through `httpStatusFor` unchanged.
   */
  static forbiddenOrigin(): ApiError {
    return new ApiError(
      "FORBIDDEN_ORIGIN",
      CLIENT_ERROR_MESSAGES.FORBIDDEN_ORIGIN,
      403,
    );
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

const BACKEND_ERROR_CODES: ReadonlySet<string> = new Set<BackendErrorCode>([
  "VALIDATION_ERROR",
  "INVALID_JSON",
  "INVALID_CREDENTIALS",
  "INVALID_TOKEN",
  "UNAUTHENTICATED",
  "INVALID_REFRESH_TOKEN",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_BANNED",
  "EMAIL_ALREADY_EXISTS",
  "USERNAME_ALREADY_EXISTS",
  "RATE_LIMITED",
  "REQUEST_TOO_LARGE",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "INTERNAL",
]);

/**
 * Turn a response body into an ApiError.
 *
 * Anything that is not the documented envelope becomes MALFORMED_RESPONSE
 * rather than being coerced into one — a proxy error page, an HTML 502, or a
 * truncated body would otherwise be reported to the user as though the API had
 * said it.
 */
export function parseApiError(status: number, body: unknown): ApiError {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return ApiError.malformedResponse(status);
  }

  const { error } = body as { error: unknown };
  if (typeof error !== "object" || error === null) {
    return ApiError.malformedResponse(status);
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  const text =
    typeof message === "string" && message.trim() !== ""
      ? message
      : CLIENT_ERROR_MESSAGES.MALFORMED_RESPONSE;

  // A code the frontend does not know about is still a real, backend-authored
  // error, so its message is preserved and only the code is normalised. The
  // code is used for branching, and a stale branch is worse than a missing
  // one: an unrecognised code falls back to INTERNAL rather than being
  // mistaken for something it is not.
  if (typeof code !== "string" || !BACKEND_ERROR_CODES.has(code)) {
    return new ApiError("INTERNAL", text, status);
  }

  return new ApiError(code as BackendErrorCode, text, status);
}

/**
 * Whether an access token was rejected, which is the trigger for a silent
 * refresh.
 *
 * Keyed on the STATUS, not the code. The backend does not distinguish
 * "expired" from "invalid" — both are a 401 `INVALID_TOKEN` — and a future
 * backend could add another 401 code. Branching on the status means such an
 * addition cannot quietly switch refreshing off.
 *
 * This is only ever asked about a protected route's response, where a 401 has
 * exactly one meaning. `ACCOUNT_SUSPENDED` and `ACCOUNT_BANNED` are 403s, not
 * 401s: they arrive while the token is perfectly valid, so refreshing on them
 * would loop forever.
 */
export function isAccessTokenRejected(error: ApiError): boolean {
  return error.status === 401;
}

/**
 * The status the proxy should answer the browser with.
 *
 * An error carrying status 0 never had an HTTP response — the API was
 * unreachable or timed out — so there is no upstream status to pass through.
 * `503` is the honest answer: this service is up, the thing behind it is not,
 * and the caller should try again. It must not be reported as `401`, which
 * would tell the browser the session ended when nothing of the sort was
 * established.
 */
export function httpStatusFor(error: ApiError): number {
  return error.status === 0 ? 503 : error.status;
}

/**
 * Whether a failed revoke means there was nothing left to revoke.
 *
 * A logout can fail because the session is already gone — the token expired,
 * the account was suspended, or the session was revoked on another device.
 * That is not an error to report: the outcome the caller asked for has already
 * happened. Anything else (the API unreachable, a 500) is a real failure and
 * must not be mistaken for a clean logout.
 */
export function isAlreadySignedOut(error: ApiError): boolean {
  return error.status === 401 || error.status === 403;
}

/**
 * Whether the session is over and cannot be recovered.
 *
 * Only the backend may decide this: the refresh token was rejected, or the
 * account is no longer allowed to authenticate.
 *
 * A network failure is deliberately NOT included. An unreachable API is not
 * evidence that the session ended, and treating it as such would sign people
 * out every time the backend hiccups.
 */
export function isSessionOver(error: ApiError): boolean {
  return (
    error.code === "INVALID_REFRESH_TOKEN" ||
    error.code === "ACCOUNT_SUSPENDED" ||
    error.code === "ACCOUNT_BANNED"
  );
}

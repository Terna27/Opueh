import { ApiError, httpStatusFor } from "./errors";
import { assertServer } from "./server-only";
import type { SessionUser, User } from "./types";

assertServer("src/lib/api/proxy.ts");

/*
 * Shared glue for the proxy route handlers.
 *
 * Everything here is a plain function over a `Request`, with no dependency on
 * a request scope, so the handlers that use it can be called directly in tests
 * with a real `Request` object.
 */

/**
 * Reject a mutating request that did not come from this site.
 *
 * The cookies are the reason this exists. A Bearer token has to be attached
 * deliberately, so a page on another origin cannot make the browser send one;
 * a cookie rides along automatically, so the browser will happily authenticate
 * a request the user never intended. `SameSite=Lax` already keeps the cookies
 * off cross-site POSTs, and this is the second layer for the cases Lax does
 * not cover.
 *
 * Fails closed: a missing `Origin` is a rejection, not a pass. `fetch()`
 * always sets `Origin` on a non-GET request, so our own client is unaffected,
 * and the alternative — treating absence as trust — is exactly the assumption
 * an attacker would want us to make.
 *
 * Residual gap, accepted and worth stating: an Origin comparison is
 * site-scoped, not origin-scoped. A compromised sibling subdomain shares the
 * site and would pass. Closing that needs a double-submit token, which is the
 * documented escalation path if the threat model changes.
 */
export function checkSameOrigin(request: Request): ApiError | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return ApiError.forbiddenOrigin();
  }

  let originHost: string;
  try {
    // Throws for the literal "null" that sandboxed iframes and some privacy
    // modes send, which is a rejection rather than a parse failure to report.
    originHost = new URL(origin).host;
  } catch {
    return ApiError.forbiddenOrigin();
  }

  if (originHost !== new URL(request.url).host) {
    return ApiError.forbiddenOrigin();
  }

  return null;
}

export type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: ApiError };

/**
 * Read the request body as a JSON object.
 *
 * Mirrors what the Go API would say about the same input, so a malformed body
 * produces the same `INVALID_JSON` whether it is caught here or upstream.
 */
export async function readJsonObject(request: Request): Promise<BodyResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return {
      ok: false,
      error: new ApiError(
        "INVALID_JSON",
        "Request body must be valid JSON.",
        400,
      ),
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: new ApiError(
        "INVALID_JSON",
        "Request body must be a JSON object.",
        400,
      ),
    };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

/**
 * Pull one string field out of the body, for building the upstream request.
 *
 * The upstream body is assembled from named fields rather than forwarded,
 * because the Go handlers decode with `DisallowUnknownFields()` — a forwarded
 * body carrying any extra key is a 400, and a body the client controls is a
 * body the client can add fields to.
 *
 * A field that is present but not a string becomes the empty string rather
 * than being passed through. The backend's own validator then rejects it with
 * the same message it gives a missing field, so the client sees one documented
 * validation contract instead of a decoder error for a wrong type.
 */
export function stringField(
  body: Record<string, unknown>,
  name: string,
): string {
  const value = body[name];
  return typeof value === "string" ? value : "";
}

/** The API's error envelope, re-emitted so the client parses one shape. */
export function errorResponse(error: ApiError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: httpStatusFor(error) },
  );
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * What the browser is allowed to know about a signed-in user.
 *
 * Only ever `{user}`. The tokens that came back alongside this user stay in
 * httpOnly cookies and never appear in a response body.
 */
export function sessionResponse(user: User, status = 200): Response {
  const payload: SessionUser = { user };
  return jsonResponse(payload, status);
}

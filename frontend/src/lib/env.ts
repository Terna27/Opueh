/**
 * Frontend runtime configuration, read and validated in one place.
 *
 * This mirrors the backend's rule (internal/config): invalid configuration is
 * a startup failure, not a runtime surprise. A production build with no API
 * origin must not quietly fall back to localhost and ship.
 *
 * The API origin is NOT a `NEXT_PUBLIC_` variable. The browser never talks to
 * the Go API — every call goes to this app's own routes, which hold the tokens
 * in httpOnly cookies — so the browser has no reason to know the origin, and
 * no reason to carry it in its bundle. It is read from the server-only
 * `API_BASE_URL`; see src/lib/api/env.ts.
 */

/** The Go API's local origin. Must match ALLOWED_ORIGINS in the backend .env. */
const LOCAL_API_BASE_URL = "http://localhost:8080";

/**
 * How a base URL is named and justified in error messages.
 *
 * The rules below are identical for the browser-facing and server-facing
 * variables; only the wording differs, because "this is inlined into the
 * browser bundle" is the reason credentials are refused for one and not the
 * other. Parameterising the message keeps one set of URL rules rather than a
 * second copy free to drift.
 */
export type NormalizeApiBaseUrlOptions = {
  /** The environment variable's name, quoted in error messages. */
  variable?: string;
  /** Why embedding credentials is refused, appended to the error. */
  credentialReason?: string;
};

const PUBLIC_DEFAULTS = {
  variable: "NEXT_PUBLIC_API_BASE_URL",
  credentialReason:
    "Every NEXT_PUBLIC_ value is compiled into the browser bundle and is public.",
} as const;

/**
 * Normalizes an API base URL into the form request paths are joined onto:
 * no trailing slash, so `${base}${path}` can never produce a double slash.
 *
 * @param raw     the raw environment value, as read from process.env
 * @param nodeEnv the current NODE_ENV
 * @throws if the value is present but unusable, or absent in production
 */
export function normalizeApiBaseUrl(
  raw: string | undefined,
  nodeEnv: string | undefined,
  options: NormalizeApiBaseUrlOptions = {},
): string {
  const { variable, credentialReason } = { ...PUBLIC_DEFAULTS, ...options };
  const value = raw?.trim();

  if (!value) {
    if (nodeEnv === "production") {
      throw new Error(
        `${variable} is required in production. Set it to the public origin of the Opueh API.`,
      );
    }
    return LOCAL_API_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${variable} must be an absolute URL, got "${value}". Example: ${LOCAL_API_BASE_URL}`,
    );
  }

  // `new URL` happily parses "localhost:8080" with "localhost" as the scheme
  // and an origin of "null", so a successful parse is not proof of a usable
  // origin. The scheme is checked explicitly instead.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${variable} must use the http or https scheme, got "${value}". Example: ${LOCAL_API_BASE_URL}`,
    );
  }

  // A base URL that carries a secret is a secret that leaks — into a browser
  // bundle for the public variable, into logs and error reports for the
  // server one. Rejecting embedded credentials keeps it out of both.
  if (parsed.username || parsed.password) {
    throw new Error(
      `${variable} must not embed credentials, got "${value}". ${credentialReason}`,
    );
  }

  // A base URL carrying a query or fragment cannot be joined with a path.
  if (parsed.search || parsed.hash) {
    throw new Error(
      `${variable} must not contain a query string or fragment, got "${value}".`,
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

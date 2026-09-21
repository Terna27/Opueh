/**
 * Frontend runtime configuration, read and validated in one place.
 *
 * This mirrors the backend's rule (internal/config): invalid configuration is
 * a startup failure, not a runtime surprise. A production build with no API
 * origin must not quietly fall back to localhost and ship.
 *
 * Only `NEXT_PUBLIC_`-prefixed variables are readable in the browser, and
 * their values are inlined at build time. Nothing secret may live here —
 * the API base URL is public by definition.
 */

/** The Go API's local origin. Must match ALLOWED_ORIGINS in the backend .env. */
const LOCAL_API_BASE_URL = "http://localhost:8080";

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
): string {
  const value = raw?.trim();

  if (!value) {
    if (nodeEnv === "production") {
      throw new Error(
        "NEXT_PUBLIC_API_BASE_URL is required in production. Set it to the public origin of the Opueh API.",
      );
    }
    return LOCAL_API_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must be an absolute URL, got "${value}". Example: ${LOCAL_API_BASE_URL}`,
    );
  }

  // `new URL` happily parses "localhost:8080" with "localhost" as the scheme
  // and an origin of "null", so a successful parse is not proof of a usable
  // origin. The scheme is checked explicitly instead.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must use the http or https scheme, got "${value}". Example: ${LOCAL_API_BASE_URL}`,
    );
  }

  // NEXT_PUBLIC_ values are compiled into the browser bundle, so anything in
  // this URL is public. Rejecting embedded credentials keeps a secret from
  // being shipped by accident.
  if (parsed.username || parsed.password) {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must not embed credentials, got "${value}". Every NEXT_PUBLIC_ value is compiled into the browser bundle and is public.`,
    );
  }

  // A base URL carrying a query or fragment cannot be joined with a path.
  if (parsed.search || parsed.hash) {
    throw new Error(
      `NEXT_PUBLIC_API_BASE_URL must not contain a query string or fragment, got "${value}".`,
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

export const env = {
  /** Origin of the Opueh Go API, e.g. "http://localhost:8080". No trailing slash. */
  apiBaseUrl: normalizeApiBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    process.env.NODE_ENV,
  ),
} as const;

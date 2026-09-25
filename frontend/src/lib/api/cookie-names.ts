/**
 * The session cookie names, in a module with no imports of its own.
 *
 * This is split out of `session.ts` for one concrete reason: `proxy.ts` needs
 * the names, and `session.ts` is request-scoped — it reads `cookies()` from
 * `next/headers`, which needs a render scope the proxy pass does not have, and
 * Next's own guidance for this file is not to rely on shared modules or
 * globals at all.
 *
 * Without this module the `__Host-` prefix rule would have to be written a
 * second time in `proxy.ts`, and the two copies would be free to drift — a
 * drift whose symptom is a production-only failure to recognise a session that
 * exists.
 *
 * Nothing here may import anything.
 */

export const ACCESS_COOKIE_BASE = "opueh_access";
export const REFRESH_COOKIE_BASE = "opueh_refresh";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export type CookieNames = {
  access: string;
  refresh: string;
};

/**
 * The cookie names for the current environment.
 *
 * The `__Host-` prefix changes the names between environments because
 * browsers only accept it on a Secure cookie with `Path=/` and no `Domain`.
 * Given those constraints it makes the cookie impossible for a sibling
 * subdomain to overwrite — a real defence, and free. It is applied in
 * production only, because a local dev server over plain http could not set
 * it, and a cookie the browser rejects is a session that never persists.
 */
export function cookieNames(isProd: boolean = isProduction()): CookieNames {
  const prefix = isProd ? "__Host-" : "";
  return {
    access: `${prefix}${ACCESS_COOKIE_BASE}`,
    refresh: `${prefix}${REFRESH_COOKIE_BASE}`,
  };
}

/*
 * The `?next=` parameter, and the only rules that make it safe to follow.
 *
 * Both `proxy.ts` and the client guard want to send a user back where they
 * were headed after signing in, so the destination arrives from the URL. A
 * value taken from the URL and handed to `router.push` or a redirect is an
 * open redirect unless it is checked, and the check has to be an allowlist
 * rather than a blocklist: the interesting inputs are the ones that look
 * relative and are not.
 *
 * `//evil.example` is the classic one — a protocol-relative URL that a naive
 * `startsWith("/")` accepts and the browser follows off-site. `/\evil.example`
 * is the same trick written with a backslash, which browsers normalise to a
 * forward slash when it appears in the authority position.
 */

/**
 * The value if it is a path on this site, or null if it must not be followed.
 *
 * Returns null rather than a fallback so the caller decides what to do — a
 * caller that silently substituted "/" would be hiding a malformed redirect
 * instead of just not following it.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }

  // Must be a path, which rules out "https://evil.example", "javascript:" and
  // every other absolute form in one step.
  if (!value.startsWith("/")) {
    return null;
  }

  // Protocol-relative: the browser reads this as a host, not a path.
  if (value.startsWith("//")) {
    return null;
  }

  // A backslash anywhere is refused, not just in the second position. Browsers
  // treat "\" and "/" as interchangeable in a URL's authority, so there is no
  // spelling of this that is worth trying to enumerate.
  if (value.includes("\\")) {
    return null;
  }

  // Control characters, which a percent-encoded newline can smuggle in and a
  // header-based redirect would then split on.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  return value;
}

/**
 * Build a login link that returns the user to `path` afterwards.
 *
 * The path is encoded rather than interpolated, and only ever appended when it
 * passes `safeNext` — so a hostile value produces a plain `/login` instead of
 * a link carrying it forward.
 */
export function loginHrefWithNext(path: string): string {
  const next = safeNext(path);
  return next === null
    ? "/login"
    : `/login?next=${encodeURIComponent(next)}`;
}

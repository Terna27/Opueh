import { NextResponse, type NextRequest } from "next/server";

import { cookieNames } from "@/lib/api/cookie-names";

/*
 * An optimistic gate for authenticated routes.
 *
 * This answers exactly one question — is a session cookie present? — and it is
 * worth being precise about why that is all it can do. Proxy runs before the
 * request reaches the app: it cannot verify a JWT (the signing key is
 * server-side, and doing crypto on every request is not this layer's job) and
 * it cannot tell whether the user has finished onboarding (that needs a
 * database read). So it is biased towards letting people in.
 *
 * It is genuinely useful anyway. It catches the ordinary case — someone
 * following a link to a protected page with no session at all — before a
 * round trip, and redirects them to the login page already knowing where they
 * were going.
 *
 * What it is NOT is the authorization boundary. `RequireSession` re-checks on
 * the client against a session the Go API has confirmed, and the proxy route
 * handlers refuse every call without a token the API accepts. A forged cookie
 * gets past this file and is stopped by both of those.
 *
 * This is Next 16's `proxy.ts`. The `middleware.ts` convention it replaced is
 * deprecated — same function, same `config.matcher`, a new name.
 */

export function proxy(request: NextRequest): NextResponse {
  const names = cookieNames();
  const hasSession =
    request.cookies.has(names.access) || request.cookies.has(names.refresh);

  if (hasSession) {
    return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  // Where they were going, so the login form can return them there. Only the
  // path and query are carried: the origin is not the client's to supply, and
  // `safeNext` re-checks this on the way back in.
  login.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  return NextResponse.redirect(login);
}

export const config = {
  /*
   * Only the authenticated routes, matched explicitly.
   *
   * A negative matcher — everything except the public pages — would have to be
   * updated every time a public route is added, and the failure mode of
   * forgetting is that a public page starts demanding a login. Listing the
   * protected routes inverts that: a new page is public until it is added
   * here, which is the safe direction for the mistake to point.
   *
   * It also matters more here than it looks: without a matcher this file runs
   * on EVERY request, static assets included, and an auth redirect pointed at
   * CSS or JS would break pages in a way that looks nothing like its cause.
   */
  matcher: ["/onboarding", "/settings/:path*"],
};

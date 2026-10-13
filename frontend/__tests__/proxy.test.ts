/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";

/*
 * The optimistic gate.
 *
 * This `proxy.ts` is Next 16's file convention, renamed from `middleware.ts`
 * (deprecated) with the same function, the same `config.matcher`, and a new
 * name.
 *
 * It answers exactly one question — is a session cookie present? — and the
 * tests below are about how carefully it answers it. The cookie names are
 * environment-dependent (`__Host-` in production), and a mismatch between what
 * the app sets and what this file looks for would be a production-only failure
 * to recognise a session that exists.
 */

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    headers: cookie ? { cookie } : {},
  });
}

/** Next marks a passed-through response with this header. */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("lets a request through when the access cookie is present", () => {
    const response = proxy(request("/settings/profile", "opueh_access=abc"));

    expect(passedThrough(response)).toBe(true);
  });

  it("lets a request through when only the refresh cookie is present", () => {
    // A dead access cookie with a live refresh token is the ordinary state
    // between an access token expiring and the next call rotating it. Turning
    // it away here would sign out everyone whose token was about to be
    // refreshed.
    const response = proxy(request("/onboarding", "opueh_refresh=abc"));

    expect(passedThrough(response)).toBe(true);
  });

  it("redirects to login when neither cookie is present", () => {
    const response = proxy(request("/settings/profile"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/login");
    // WHERE they were going, so the login form can return them there.
    expect(location.searchParams.get("next")).toBe("/settings/profile");
  });

  it("carries the query string in next", () => {
    const response = proxy(request("/settings/profile?tab=bio"));

    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get("next")).toBe("/settings/profile?tab=bio");
  });

  it("carries only the path, never an origin supplied by the client", () => {
    const response = proxy(request("/settings/profile"));

    const location = new URL(response.headers.get("location") as string);
    const next = location.searchParams.get("next") as string;
    // An absolute URL here would be an open redirect. The path is what
    // `safeNext` re-checks on the way back in.
    expect(next).not.toContain("localhost");
    expect(next.startsWith("/")).toBe(true);
  });

  it("ignores a cookie that is not a session cookie", () => {
    const response = proxy(request("/settings/profile", "theme=dark"));

    expect(response.status).toBe(307);
  });

  it("recognises the __Host- prefixed names in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    // The names the app SETS in production. Looking for the unprefixed ones
    // here would redirect every signed-in user to the login page — a failure
    // that could not happen locally.
    const withSession = proxy(
      request("/settings/profile", "__Host-opueh_access=abc"),
    );
    expect(passedThrough(withSession)).toBe(true);

    const withoutSession = proxy(
      request("/settings/profile", "opueh_access=abc"),
    );
    expect(withoutSession.status).toBe(307);
  });
});

describe("the matcher", () => {
  it("lists the protected routes explicitly", () => {
    // An allowlist rather than a negative matcher. The failure mode of
    // forgetting to update an exclusion list is that a public page starts
    // demanding a login; listing the protected routes inverts that, so a new
    // page is public until it is deliberately added here.
    expect(config.matcher).toEqual(["/onboarding", "/settings/:path*"]);
  });

  it("does not match the public pages", () => {
    for (const path of ["/", "/login", "/register", "/u/ada"]) {
      expect(config.matcher).not.toContain(path);
    }
  });
});

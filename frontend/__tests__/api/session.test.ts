/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  clearingCookieWrites,
  cookieNames,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  sessionCookieWrites,
  tokensFromAuthResponse,
} from "@/lib/api/session";

/*
 * These attributes are the security boundary of the whole design: httpOnly is
 * what keeps a token out of reach of any JavaScript that ends up running on
 * the page. They are asserted here as plain values, with no request scope,
 * because `sessionCookieWrites` is pure.
 */

const TOKENS = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  accessTokenMaxAge: 900,
};

describe("cookieNames", () => {
  it("uses the __Host- prefix in production only", () => {
    expect(cookieNames(true)).toEqual({
      access: "__Host-opueh_access",
      refresh: "__Host-opueh_refresh",
    });

    // __Host- requires Secure, which a plain-http dev server cannot set.
    expect(cookieNames(false)).toEqual({
      access: "opueh_access",
      refresh: "opueh_refresh",
    });
  });
});

describe("sessionCookieWrites", () => {
  it("marks both cookies httpOnly, lax and site-wide", () => {
    const writes = sessionCookieWrites(TOKENS, false);

    expect(writes).toHaveLength(2);
    for (const write of writes) {
      // The reason a token cannot be read by injected script.
      expect(write.options.httpOnly).toBe(true);
      // The primary CSRF defence: keeps the cookies off cross-site POSTs.
      expect(write.options.sameSite).toBe("lax");
      expect(write.options.path).toBe("/");
      // Not Secure in development, or a plain-http localhost could not set it.
      expect(write.options.secure).toBe(false);
    }
  });

  it("adds Secure in production, as __Host- requires", () => {
    for (const write of sessionCookieWrites(TOKENS, true)) {
      expect(write.options.secure).toBe(true);
    }
  });

  it("takes the access lifetime from the API's expires_in", () => {
    const [access] = sessionCookieWrites(
      { ...TOKENS, accessTokenMaxAge: 1234 },
      false,
    );

    // Not a hardcoded 15 minutes: a deployment that retunes ACCESS_TOKEN_TTL
    // must not leave the browser holding a token it believes is fresh.
    expect(access.options.maxAge).toBe(1234);
  });

  it("gives the refresh cookie the documented lifetime", () => {
    const [, refresh] = sessionCookieWrites(TOKENS, false);

    // This is the one guessed number in the design — the auth response says
    // nothing about refresh-token expiry. Being wrong only changes when the
    // browser forgets it; the backend remains the authority on validity.
    expect(refresh.options.maxAge).toBe(REFRESH_COOKIE_MAX_AGE_SECONDS);
  });
});

describe("clearingCookieWrites", () => {
  it("expires both cookies using the names they were set with", () => {
    const writes = clearingCookieWrites(false);

    expect(writes.map((write) => write.name)).toEqual([
      "opueh_access",
      "opueh_refresh",
    ]);
    // A clear whose name does not match the set would silently miss and leave
    // a live refresh token in the browser.
    for (const write of writes) {
      expect(write.options.maxAge).toBe(0);
      expect(write.options.httpOnly).toBe(true);
    }
  });

  it("clears the prefixed names in production", () => {
    expect(clearingCookieWrites(true).map((write) => write.name)).toEqual([
      "__Host-opueh_access",
      "__Host-opueh_refresh",
    ]);
  });
});

describe("tokensFromAuthResponse", () => {
  it("maps the API's snake_case payload onto the session shape", () => {
    expect(
      tokensFromAuthResponse({
        access_token: "a",
        refresh_token: "r",
        expires_in: 900,
      }),
    ).toEqual({
      accessToken: "a",
      refreshToken: "r",
      accessTokenMaxAge: 900,
    });
  });
});

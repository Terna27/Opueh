import { describe, expect, it } from "vitest";

import { loginHrefWithNext, safeNext } from "@/lib/account/next-param";

/*
 * The `?next=` rules.
 *
 * These are what make the post-login redirect safe to ship. The value comes
 * from the URL and ends up in `router.replace` and in a `Location` header, so
 * an unvalidated one is an open redirect — and the inputs that matter are the
 * ones that LOOK like a path without being one.
 */

describe("safeNext", () => {
  it("accepts a path on this site", () => {
    expect(safeNext("/settings/profile")).toBe("/settings/profile");
  });

  it("accepts a path carrying a query string", () => {
    expect(safeNext("/settings/profile?tab=bio")).toBe(
      "/settings/profile?tab=bio",
    );
  });

  it("refuses a protocol-relative URL", () => {
    // Passes a naive `startsWith("/")`, and the browser reads it as a host
    // rather than a path — the classic open redirect.
    expect(safeNext("//evil.example")).toBeNull();
  });

  it("refuses a backslash in the authority position", () => {
    // Browsers normalise "\" to "/" there, so this is the same trick spelled
    // differently. Refusing only this spelling would leave the next one open.
    expect(safeNext("/\\evil.example")).toBeNull();
  });

  it("refuses a backslash anywhere", () => {
    expect(safeNext("/settings\\profile")).toBeNull();
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("http://evil.example/")).toBeNull();
  });

  it("refuses a javascript: URL", () => {
    expect(safeNext("javascript:alert(1)")).toBeNull();
  });

  it("refuses the empty string and absent values", () => {
    expect(safeNext("")).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it("refuses control characters", () => {
    // A newline here would split a Location header if it ever reached one.
    expect(safeNext("/settings\nLocation: https://evil.example")).toBeNull();
    expect(safeNext("/settings\r\nX-Injected: y")).toBeNull();
    expect(safeNext("/settings\u0000")).toBeNull();
    expect(safeNext("/settings\u007f")).toBeNull();
  });
});

describe("loginHrefWithNext", () => {
  it("carries an accepted path, encoded", () => {
    expect(loginHrefWithNext("/settings/profile")).toBe(
      "/login?next=%2Fsettings%2Fprofile",
    );
  });

  it("encodes the path so it cannot escape the query string", () => {
    // Interpolated raw, the "&" would become a second query parameter.
    expect(loginHrefWithNext("/a?b=1&c=2")).toBe(
      "/login?next=%2Fa%3Fb%3D1%26c%3D2",
    );
  });

  it("falls back to a bare /login for a value it will not follow", () => {
    // Not a link carrying the value forward, and not a redirect to it either.
    expect(loginHrefWithNext("//evil.example")).toBe("/login");
    expect(loginHrefWithNext("")).toBe("/login");
  });
});

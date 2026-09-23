/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, requestUpstream } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { RefreshOutcome } from "@/lib/api/refresh";
import type { SessionTokens } from "@/lib/api/session";
import type { User } from "@/lib/api/types";

/*
 * The transport's job is the retry decision, so that is what these tests
 * pin down: exactly one retry, only on a 401, and only for a request that
 * actually presented a token. Getting that wrong is not a failed call — a
 * second refresh presents a consumed token and revokes the session.
 */

const TOKENS: SessionTokens = {
  accessToken: "access-fresh",
  refreshToken: "refresh-fresh",
  accessTokenMaxAge: 900,
};

const USER: User = {
  id: "11111111-1111-1111-1111-111111111111",
  username: "ada",
  display_name: "Ada",
  email: "ada@example.com",
  role: "USER",
  status: "ACTIVE",
  email_verified: false,
  created_at: "2026-01-01T00:00:00Z",
};

const REFRESHED: RefreshOutcome = {
  status: "refreshed",
  tokens: TOKENS,
  user: USER,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorBody(code: string, message = "nope") {
  return { error: { code, message } };
}

/** The URL and init of the nth fetch call, for asserting what was sent. */
function callArgs(index: number): [string, RequestInit] {
  const call = vi.mocked(fetch).mock.calls[index];
  return [call[0] as string, call[1] as RequestInit];
}

beforeEach(() => {
  vi.stubEnv("API_BASE_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requestUpstream", () => {
  it("sends the request to the configured origin with a Bearer token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true }, 200)),
    );

    const result = await requestUpstream<{ ok: boolean }>({
      path: "/api/v1/me",
      method: "GET",
      accessToken: "access-1",
    });

    expect(result).toEqual({ ok: true, data: { ok: true } });
    const [url, init] = callArgs(0);
    expect(url).toBe("http://api.test/api/v1/me");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-1",
    );
  });

  it("omits the Authorization header when there is no token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 200)));

    await requestUpstream({ path: "/api/v1/auth/login", method: "POST" });

    const [, init] = callArgs(0);
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("reports an unreachable API as an unavailability with no status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await requestUpstream({
      path: "/api/v1/me",
      method: "GET",
      accessToken: "access-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("UPSTREAM_UNAVAILABLE");
    // Status 0 is the marker of "no HTTP verdict", and it is what makes the
    // proxy answer 503 rather than passing a misleading status through.
    expect(result.error.status).toBe(0);
  });

  it("reports a timeout as an unavailability rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );

    const result = await requestUpstream(
      { path: "/api/v1/me", method: "GET", accessToken: "access-1" },
      { timeoutMs: 5 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("parses the API's error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(errorBody("INVALID_CREDENTIALS", "Bad credentials."), 401),
      ),
    );

    const result = await requestUpstream({
      path: "/api/v1/auth/login",
      method: "POST",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("INVALID_CREDENTIALS");
    expect(result.error.message).toBe("Bad credentials.");
    expect(result.error.status).toBe(401);
  });

  it("does not mistake a non-envelope body for the API's own error", async () => {
    // An HTML error page from something in front of the API. Reporting its
    // text as though the API had said it would be a fabrication.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>Bad Gateway</html>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    const result = await requestUpstream({
      path: "/api/v1/me",
      method: "GET",
      accessToken: "access-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
    expect(result.error.status).toBe(502);
  });

  it("reports a 200 whose body is not JSON as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );

    const result = await requestUpstream({
      path: "/api/v1/me",
      method: "GET",
      accessToken: "access-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("treats a 204 as success with no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const result = await requestUpstream({
      path: "/api/v1/auth/logout",
      method: "POST",
      accessToken: "access-1",
    });

    expect(result.ok).toBe(true);
  });

  it("never retries on its own", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(errorBody("INTERNAL", "boom"), 500),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestUpstream({
      path: "/api/v1/me",
      method: "GET",
      accessToken: "access-1",
    });

    // A retry is how a refresh token gets replayed; the decision belongs to
    // apiFetch, which knows whether retrying is safe.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("apiFetch", () => {
  it("refreshes on a 401 and retries once with the new token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(errorBody("INVALID_TOKEN"), 401))
      .mockResolvedValueOnce(jsonResponse({ id: "u1" }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => REFRESHED);

    const result = await apiFetch<{ id: string }>(
      { path: "/api/v1/me", method: "GET", accessToken: "access-stale" },
      refresh,
    );

    expect(result).toEqual({ ok: true, data: { id: "u1" } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry carries the token the refresh minted, not the stale one.
    expect(
      (callArgs(1)[1].headers as Record<string, string>).Authorization,
    ).toBe("Bearer access-fresh");
  });

  it("retries exactly once, and gives up on a second 401", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(errorBody("INVALID_TOKEN"), 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => REFRESHED);

    const result = await apiFetch(
      { path: "/api/v1/me", method: "GET", accessToken: "access-stale" },
      refresh,
    );

    expect(result.ok).toBe(false);
    // One retry, one refresh. A second round would present a token the first
    // refresh had already consumed.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a 401 from a request that carried no token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(errorBody("INVALID_CREDENTIALS"), 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => REFRESHED);

    const result = await apiFetch(
      { path: "/api/v1/auth/login", method: "POST" },
      refresh,
    );

    expect(result.ok).toBe(false);
    // A failed login is a wrong password, not an expired token. Refreshing
    // here would be meaningless and would burn a rotation.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh a 403", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(errorBody("ACCOUNT_SUSPENDED", "Account suspended."), 403),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => REFRESHED);

    const result = await apiFetch(
      { path: "/api/v1/me", method: "GET", accessToken: "access-1" },
      refresh,
    );

    expect(result.ok).toBe(false);
    // ACCOUNT_SUSPENDED arrives while the access token is still valid, so
    // refreshing would loop forever without changing the answer.
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the API was unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const refresh = vi.fn(async () => REFRESHED);

    const result = await apiFetch(
      { path: "/api/v1/me", method: "GET", accessToken: "access-1" },
      refresh,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable refresh without retrying", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(errorBody("INVALID_TOKEN"), 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: "unavailable",
        error: ApiError.upstreamUnavailable(),
      }),
    );

    const result = await apiFetch(
      { path: "/api/v1/me", method: "GET", accessToken: "access-1" },
      refresh,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    // A 503 downstream, not a 401: the session is not known to be over.
    expect(result.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected refresh token as the session being over", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(errorBody("INVALID_TOKEN"), 401)),
    );
    const refresh = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: "session-over",
        error: new ApiError(
          "INVALID_REFRESH_TOKEN",
          "Refresh token is invalid.",
          401,
        ),
      }),
    );

    const result = await apiFetch(
      { path: "/api/v1/me", method: "GET", accessToken: "access-1" },
      refresh,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("INVALID_REFRESH_TOKEN");
  });
});

/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The proxy handlers, invoked as plain functions with real `Request` objects.
 *
 * That is the reason the contract layer is split into pure functions: the
 * parts worth testing — the Origin check, the field-by-field upstream body,
 * and what happens to the cookies on each outcome — are all reachable without
 * a Next server or a browser.
 *
 * `next/headers` is mocked with an in-memory cookie jar, because a handler's
 * `cookies().set()` writes Set-Cookie headers onto the real response and there
 * is no request scope here. The cookie ATTRIBUTES are asserted directly
 * against `sessionCookieWrites` in the session tests; what these tests check is
 * which handler writes or clears them, and when.
 */

const cookieJar = vi.hoisted(
  () => new Map<string, { value: string; options?: Record<string, unknown> }>(),
);

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieJar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieJar.set(name, { value, options });
    },
  }),
}));

const { POST: register } = await import("@/app/api/auth/register/route");
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: refreshRoute } = await import("@/app/api/auth/refresh/route");
const { GET: me } = await import("@/app/api/auth/me/route");

const ORIGIN = "http://localhost:3000";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  username: "ada",
  display_name: "Ada",
  email: "ada@example.com",
  role: "USER",
  status: "ACTIVE",
  email_verified: false,
  created_at: "2026-01-01T00:00:00Z",
};

const AUTH_RESPONSE = {
  user: USER,
  access_token: "access-1",
  token_type: "Bearer",
  expires_in: 900,
  refresh_token: "refresh-1",
};

function postJson(path: string, body: unknown, headers = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorBody(code: string, message = "nope") {
  return { error: { code, message } };
}

/** The parsed body of the nth upstream fetch. */
function sentBody(index: number): Record<string, unknown> {
  const init = vi.mocked(fetch).mock.calls[index][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  cookieJar.clear();
  vi.stubEnv("API_BASE_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/auth/register", () => {
  it("returns the user and stores the tokens as cookies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(AUTH_RESPONSE, 201)),
    );

    const response = await register(
      postJson("/api/auth/register", {
        email: "ada@example.com",
        username: "ada",
        password: "correct horse battery staple",
        display_name: "Ada",
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    // The tokens must not appear in the body the browser receives.
    expect(Object.keys(payload)).toEqual(["user"]);
    expect(JSON.stringify(payload)).not.toContain("access-1");

    const access = cookieJar.get("opueh_access");
    expect(access?.value).toBe("access-1");
    expect(access?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // The access cookie's lifetime comes from the API's own expires_in.
      maxAge: 900,
    });
    expect(cookieJar.get("opueh_refresh")?.value).toBe("refresh-1");
  });

  it("builds the upstream body field by field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(AUTH_RESPONSE, 201)),
    );

    await register(
      postJson("/api/auth/register", {
        email: "ada@example.com",
        username: "ada",
        password: "correct horse battery staple",
        display_name: "Ada",
        // The Go decoder rejects unknown fields with a 400, so forwarding the
        // browser's body would both break here and let a client inject fields.
        role: "ADMIN",
        status: "ACTIVE",
      }),
    );

    expect(sentBody(0)).toEqual({
      email: "ada@example.com",
      username: "ada",
      password: "correct horse battery staple",
      display_name: "Ada",
    });
  });

  it("passes the backend's validation error through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          errorBody("VALIDATION_ERROR", "password must be at least 8 characters"),
          400,
        ),
      ),
    );

    const response = await register(
      postJson("/api/auth/register", {
        email: "ada@example.com",
        username: "ada",
        password: "short",
        display_name: "Ada",
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    // The single string the backend sends is the contract, not a per-field
    // mapping invented on this side.
    expect(payload.error.message).toBe(
      "password must be at least 8 characters",
    );
    expect(cookieJar.size).toBe(0);
  });

  it("rejects a request from another origin without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await register(
      postJson(
        "/api/auth/register",
        { email: "a@b.c", username: "ada", password: "x", display_name: "" },
        { Origin: "http://evil.example" },
      ),
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a mutating request with no Origin at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await register(
      postJson(
        "/api/auth/register",
        { email: "a@b.c", username: "ada", password: "x", display_name: "" },
        { Origin: "" },
      ),
    );

    // Fails closed: absence is not trust.
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with the code the API would use", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await register(
      new Request(`${ORIGIN}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: "{ not json",
      }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("INVALID_JSON");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  it("stores the session on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(AUTH_RESPONSE)));

    const response = await login(
      postJson("/api/auth/login", {
        identifier: "ada",
        password: "correct horse battery staple",
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).user.username).toBe("ada");
    expect(cookieJar.get("opueh_access")?.value).toBe("access-1");
  });

  it("writes no cookies when the credentials are wrong", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(errorBody("INVALID_CREDENTIALS", "Invalid credentials."), 401),
      ),
    );

    const response = await login(
      postJson("/api/auth/login", { identifier: "ada", password: "wrong" }),
    );

    expect(response.status).toBe(401);
    // A failed login must not clear a session that was already there, nor
    // start one.
    expect(cookieJar.size).toBe(0);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes upstream then clears both cookies", async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requested.push(url);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });
    cookieJar.set("opueh_refresh", { value: "refresh-1" });

    const response = await logout(postJson("/api/auth/logout", {}));

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requested).toEqual(["http://api.test/api/v1/auth/logout"]);

    // ORDERING: the revoke happens FIRST. A refresh racing this can write
    // fresh cookies afterwards, and they are inert only because the session
    // was already revoked in the database.
    expect(cookieJar.get("opueh_access")?.options?.maxAge).toBe(0);
    expect(cookieJar.get("opueh_refresh")?.options?.maxAge).toBe(0);
  });

  it("clears the cookies even when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await logout(postJson("/api/auth/logout", {}));

    // The browser is signed out either way, so the local session must end...
    expect(cookieJar.get("opueh_access")?.options?.maxAge).toBe(0);
    // ...but the user is told the server's copy may still be alive, rather
    // than being left to believe a session was ended when it was not.
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("treats an already-dead session as a clean logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(errorBody("UNAUTHENTICATED"), 401)),
    );
    cookieJar.set("opueh_access", { value: "access-stale" });

    const response = await logout(postJson("/api/auth/logout", {}));

    // There was nothing left to revoke, which is the outcome that was asked
    // for. Reporting a 401 here would tell the user their logout failed.
    expect(response.status).toBe(204);
    expect(cookieJar.get("opueh_access")?.options?.maxAge).toBe(0);
  });

  it("does not call the API when there is no session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await logout(postJson("/api/auth/logout", {}));

    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(USER)));
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await me();

    expect(response.status).toBe(200);
    expect((await response.json()).user.username).toBe("ada");
  });

  it("reports not-signed-in without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await me();

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes and retries once when the access cookie has expired", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(errorBody("INVALID_TOKEN"), 401))
      .mockResolvedValueOnce(jsonResponse(AUTH_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(USER));
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-stale" });
    cookieJar.set("opueh_refresh", { value: "refresh-1" });

    const response = await me();

    expect(response.status).toBe(200);
    // The rotated pair is stored, so the next request starts fresh.
    expect(cookieJar.get("opueh_access")?.value).toBe("access-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears the session when the refresh token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/refresh")
          ? jsonResponse(errorBody("INVALID_REFRESH_TOKEN"), 401)
          : jsonResponse(errorBody("INVALID_TOKEN"), 401),
      ),
    );
    cookieJar.set("opueh_access", { value: "access-stale" });
    cookieJar.set("opueh_refresh", { value: "refresh-dead" });

    const response = await me();

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_REFRESH_TOKEN");
    expect(cookieJar.get("opueh_access")?.options?.maxAge).toBe(0);
    expect(cookieJar.get("opueh_refresh")?.options?.maxAge).toBe(0);
  });

  it("keeps the session when the API is merely unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    cookieJar.set("opueh_access", { value: "access-1" });
    cookieJar.set("opueh_refresh", { value: "refresh-1" });

    const response = await me();

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("UPSTREAM_UNAVAILABLE");
    // Nothing was cleared: an unreachable API is not evidence the session
    // ended, and signing someone out over a blip is worse than the blip.
    expect(cookieJar.get("opueh_access")?.value).toBe("access-1");
    expect(cookieJar.get("opueh_access")?.options?.maxAge).not.toBe(0);
  });
});

describe("POST /api/auth/refresh", () => {
  it("stores the rotated pair", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(AUTH_RESPONSE)));
    cookieJar.set("opueh_refresh", { value: "refresh-1" });

    const response = await refreshRoute(postJson("/api/auth/refresh", {}));

    expect(response.status).toBe(200);
    expect(cookieJar.get("opueh_access")?.value).toBe("access-1");
    expect(cookieJar.get("opueh_refresh")?.value).toBe("refresh-1");
  });

  it("rejects a cross-origin refresh", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await refreshRoute(
      postJson("/api/auth/refresh", {}, { Origin: "http://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears the session when the refresh token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(errorBody("INVALID_REFRESH_TOKEN"), 401)),
    );
    cookieJar.set("opueh_refresh", { value: "refresh-dead" });

    const response = await refreshRoute(postJson("/api/auth/refresh", {}));

    expect(response.status).toBe(401);
    expect(cookieJar.get("opueh_refresh")?.options?.maxAge).toBe(0);
  });
});

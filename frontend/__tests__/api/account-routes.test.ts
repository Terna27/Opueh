/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The M5 proxy handlers, invoked as plain functions with real `Request`
 * objects — the same approach as `api/routes.test.ts`, and for the same
 * reason: the parts worth testing (the Origin check, the field-by-field
 * upstream body, what a failure leaves in the cookie jar) need no Next server
 * and no browser.
 *
 * `next/headers` is mocked with an in-memory jar. Treating it as an
 * observable side effect is what makes "a failed call writes no cookies"
 * assertable at all.
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

const { GET: getCategories } = await import("@/app/api/categories/route");
const { GET: getInterests, PUT: putInterests } = await import(
  "@/app/api/me/interests/route"
);
const { GET: getProfile, PATCH: patchProfile } = await import(
  "@/app/api/me/profile/route"
);

const ORIGIN = "http://localhost:3000";

const CATEGORY = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Music",
  slug: "music",
  description: null,
};

const MY_PROFILE = {
  id: "22222222-2222-2222-2222-222222222222",
  username: "ada",
  display_name: "Ada",
  bio: null,
  email: "ada@example.com",
  role: "USER",
  email_verified: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function mutate(
  path: string,
  method: "PUT" | "PATCH",
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
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

/** The parsed body of the nth upstream fetch, or undefined when there was none. */
function sentBody(index: number): Record<string, unknown> | undefined {
  const init = vi.mocked(fetch).mock.calls[index]?.[1] as RequestInit | undefined;
  if (init?.body === undefined) return undefined;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function sentUrl(index: number): string {
  return vi.mocked(fetch).mock.calls[index][0] as string;
}

beforeEach(() => {
  cookieJar.clear();
  vi.stubEnv("API_BASE_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/categories", () => {
  it("passes the upstream envelope through, needing no session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ categories: [CATEGORY] })),
    );

    const response = await getCategories();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ categories: [CATEGORY] });
    expect(sentUrl(0)).toBe("http://api.test/api/v1/categories");
    // No Origin check on a safe method with no side effect for the caller, and
    // no token: this is the one endpoint a signed-out visitor may read.
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("reports an unreachable API as 503, not as an empty catalogue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const response = await getCategories();

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("GET /api/me/interests", () => {
  it("passes the chosen categories through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [CATEGORY] })),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await getInterests();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ interests: [CATEGORY] });
  });

  it("treats an empty list as a valid answer, not a failure", async () => {
    // What a user who has not onboarded yet gets. Reading it as an error would
    // make onboarding page itself fail for the people it exists for.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [] })),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await getInterests();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ interests: [] });
  });

  it("refuses without a session, without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await getInterests();

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/me/interests", () => {
  it("sends the whole selection as category_ids and returns the stored set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [CATEGORY] })),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await putInterests(
      mutate("/api/me/interests", "PUT", { category_ids: [CATEGORY.id] }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ interests: [CATEGORY] });
    expect(sentUrl(0)).toBe("http://api.test/api/v1/me/interests");
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PUT");
    // Duplicates are sent as-is: the backend rejects them rather than
    // collapsing them, and de-duplicating here would hide that from the user.
    expect(sentBody(0)).toEqual({ category_ids: [CATEGORY.id] });
  });

  it("forwards only category_ids, so a client cannot add upstream fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [] })),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    await putInterests(
      mutate("/api/me/interests", "PUT", {
        category_ids: [CATEGORY.id],
        // DisallowUnknownFields() upstream would 400 on these, and a body the
        // client controls is a body the client can add fields to.
        user_id: "someone-else",
        role: "ADMIN",
      }),
    );

    expect(sentBody(0)).toEqual({ category_ids: [CATEGORY.id] });
  });

  it("sends an empty array for a missing or non-array field, and lets the backend judge it", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(errorBody("VALIDATION_ERROR", "at least 1 category must be supplied"), 400),
    );
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });

    await putInterests(mutate("/api/me/interests", "PUT", {}));
    await putInterests(
      mutate("/api/me/interests", "PUT", { category_ids: "not-an-array" }),
    );

    // Both reach the backend, because the count rule is the backend's to
    // state. Raising INVALID_JSON here would be a second copy of it.
    expect(sentBody(0)).toEqual({ category_ids: [] });
    expect(sentBody(1)).toEqual({ category_ids: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps CATEGORY_NOT_FOUND intact, so the caller can branch on it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(errorBody("CATEGORY_NOT_FOUND", "one or more categories do not exist"), 404),
      ),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await putInterests(
      mutate("/api/me/interests", "PUT", { category_ids: ["00000000-0000-0000-0000-000000000000"] }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("CATEGORY_NOT_FOUND");
    // A failed write must not disturb the session that made it.
    expect(cookieJar.get("opueh_access")?.options?.maxAge).not.toBe(0);
  });

  it("rejects a cross-origin PUT without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await putInterests(
      mutate(
        "/api/me/interests",
        "PUT",
        { category_ids: [CATEGORY.id] },
        { Origin: "http://evil.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a PUT with no Origin at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await putInterests(
      mutate("/api/me/interests", "PUT", { category_ids: [] }, { Origin: "" }),
    );

    // Fails closed. The cookies ride along automatically, which is exactly why
    // absence of an Origin is not something to trust.
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed body before reaching the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await putInterests(
      mutate("/api/me/interests", "PUT", "{ not json"),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without a session, even from the right origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await putInterests(
      mutate("/api/me/interests", "PUT", { category_ids: [] }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/me/profile", () => {
  it("passes the bare profile through, with no wrapper added", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await getProfile();

    expect(response.status).toBe(200);
    // Both sides of the proxy see one shape. An envelope added here would mean
    // `MyProfile` described something different from what the API sends.
    expect(await response.json()).toEqual(MY_PROFILE);
    expect(sentUrl(0)).toBe("http://api.test/api/v1/me/profile");
  });

  it("keeps USER_NOT_FOUND intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(errorBody("USER_NOT_FOUND", "user not found"), 404),
      ),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await getProfile();

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("USER_NOT_FOUND");
  });

  it("refuses without a session, without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await getProfile();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/me/profile", () => {
  it("sends only the fields supplied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));
    cookieJar.set("opueh_access", { value: "access-1" });

    await patchProfile(
      mutate("/api/me/profile", "PATCH", { display_name: "Ada Lovelace" }),
    );

    expect(sentUrl(0)).toBe("http://api.test/api/v1/me/profile");
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("PATCH");
    // The whole subtlety of this endpoint. Upstream the fields are pointers,
    // so an omitted `bio` leaves the existing bio alone — sending `bio: ""`
    // for a field the user never touched would erase it on every save.
    expect(sentBody(0)).toEqual({ display_name: "Ada Lovelace" });
  });

  it("sends a supplied empty bio, because that is a deliberate clear", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));
    cookieJar.set("opueh_access", { value: "access-1" });

    await patchProfile(mutate("/api/me/profile", "PATCH", { bio: "" }));

    expect(sentBody(0)).toEqual({ bio: "" });
  });

  it("omits a non-string field rather than coercing it to an empty string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          errorBody("VALIDATION_ERROR", "at least one field must be supplied"),
          400,
        ),
      ),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    await patchProfile(mutate("/api/me/profile", "PATCH", { bio: 42 }));

    // Coercing `bio: 42` to "" would turn a malformed request into a
    // deliberate ERASE of the user's bio. Omitting leaves nothing to send, and
    // the backend's own "at least one field" rule then says so.
    expect(sentBody(0)).toEqual({});
  });

  it("forwards an empty patch and lets the backend state the rule", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          errorBody("VALIDATION_ERROR", "at least one field must be supplied"),
          400,
        ),
      ),
    );
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await patchProfile(
      mutate("/api/me/profile", "PATCH", { unknown_field: "x" }),
    );

    expect(sentBody(0)).toEqual({});
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "at least one field must be supplied",
    );
  });

  it("rejects a cross-origin PATCH without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await patchProfile(
      mutate(
        "/api/me/profile",
        "PATCH",
        { display_name: "Ada" },
        { Origin: "http://evil.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a PATCH with no Origin at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    cookieJar.set("opueh_access", { value: "access-1" });

    const response = await patchProfile(
      mutate("/api/me/profile", "PATCH", { display_name: "Ada" }, { Origin: "" }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
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

    const response = await patchProfile(
      mutate("/api/me/profile", "PATCH", { display_name: "Ada" }),
    );

    expect(response.status).toBe(503);
    // The save failed; the session did not. Clearing cookies here would sign
    // the user out over a blip and lose the edit they were making.
    expect(cookieJar.get("opueh_access")?.value).toBe("access-1");
    expect(cookieJar.get("opueh_access")?.options?.maxAge).not.toBe(0);
  });
});

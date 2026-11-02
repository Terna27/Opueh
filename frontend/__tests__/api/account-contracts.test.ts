/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listCategories, fetchMyInterests, replaceMyInterests } from "@/lib/api/categories";
import { fetchMyProfile, fetchPublicProfile, updateMyProfile } from "@/lib/api/profile";

/*
 * The M5 contract functions — the only place that knows the Go API's paths and
 * field names.
 *
 * What is asserted is what goes ON THE WIRE: the exact URL, the method, and
 * the body field by field. A path is copied from `internal/routes/routes.go`
 * by hand, so a mistyped one is a 404 nobody sees until a page breaks; an
 * extra body key is a 400 from `DisallowUnknownFields()`.
 */

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

const PUBLIC_PROFILE = {
  id: MY_PROFILE.id,
  username: "ada",
  display_name: "Ada",
  bio: null,
  created_at: "2026-01-01T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The URL and parsed body of the single request that was made. */
function sentRequest(): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
} {
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  return {
    url: url as string,
    method: (init as RequestInit).method as string,
    headers: (init as RequestInit).headers as Record<string, string>,
    body:
      (init as RequestInit).body === undefined
        ? undefined
        : JSON.parse((init as RequestInit).body as string),
  };
}

beforeEach(() => {
  vi.stubEnv("API_BASE_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("listCategories", () => {
  it("GETs the public taxonomy with no token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ categories: [CATEGORY] })),
    );

    const result = await listCategories();

    expect(result).toEqual({ ok: true, data: { categories: [CATEGORY] } });
    expect(sentRequest().url).toBe("http://api.test/api/v1/categories");
    expect(sentRequest().method).toBe("GET");
    expect(sentRequest().headers.Authorization).toBeUndefined();
  });
});

describe("fetchMyInterests", () => {
  it("GETs the signed-in user's selection with a Bearer token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [CATEGORY] })),
    );

    await fetchMyInterests("access-1");

    expect(sentRequest().url).toBe("http://api.test/api/v1/me/interests");
    expect(sentRequest().method).toBe("GET");
    expect(sentRequest().headers.Authorization).toBe("Bearer access-1");
  });
});

describe("replaceMyInterests", () => {
  it("PUTs the whole set as category_ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [CATEGORY] })),
    );

    await replaceMyInterests("access-1", { category_ids: [CATEGORY.id] });

    expect(sentRequest().url).toBe("http://api.test/api/v1/me/interests");
    expect(sentRequest().method).toBe("PUT");
    expect(sentRequest().headers.Authorization).toBe("Bearer access-1");
    expect(sentRequest().body).toEqual({ category_ids: [CATEGORY.id] });
  });

  it("sends an empty selection as an empty array, not an omission", async () => {
    // The backend's validator is the authority on the count, and it can only
    // say "at least 1" if it is given something to count.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ interests: [] })),
    );

    await replaceMyInterests("access-1", { category_ids: [] });

    expect(sentRequest().body).toEqual({ category_ids: [] });
  });
});

describe("fetchMyProfile", () => {
  it("GETs the bare profile with a Bearer token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));

    const result = await fetchMyProfile("access-1");

    expect(result).toEqual({ ok: true, data: MY_PROFILE });
    expect(sentRequest().url).toBe("http://api.test/api/v1/me/profile");
    expect(sentRequest().method).toBe("GET");
    expect(sentRequest().headers.Authorization).toBe("Bearer access-1");
  });
});

describe("updateMyProfile", () => {
  it("PATCHes only the field that was supplied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));

    await updateMyProfile("access-1", { display_name: "Ada Lovelace" });

    expect(sentRequest().url).toBe("http://api.test/api/v1/me/profile");
    expect(sentRequest().method).toBe("PATCH");
    // NOT `{ display_name, bio: "" }`. A bio the user never touched would be
    // erased on every display-name save.
    expect(sentRequest().body).toEqual({ display_name: "Ada Lovelace" });
  });

  it("carries an empty bio through as a clear", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));

    await updateMyProfile("access-1", { bio: "" });

    expect(sentRequest().body).toEqual({ bio: "" });
  });

  it("sends an empty object when nothing was supplied", async () => {
    // Forwarded rather than refused here: the "at least one field" rule is the
    // backend's, and it answers in its own words.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));

    await updateMyProfile("access-1", {});

    expect(sentRequest().body).toEqual({});
  });

  it("preserves interior newlines in a bio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MY_PROFILE)));

    await updateMyProfile("access-1", { bio: "Line one.\nLine two." });

    expect(sentRequest().body).toEqual({ bio: "Line one.\nLine two." });
  });
});

describe("fetchPublicProfile", () => {
  it("GETs an arbitrary username with no token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(PUBLIC_PROFILE)));

    const result = await fetchPublicProfile("ada");

    expect(result).toEqual({ ok: true, data: PUBLIC_PROFILE });
    expect(sentRequest().url).toBe("http://api.test/api/v1/users/ada");
    expect(sentRequest().headers.Authorization).toBeUndefined();
  });

  it("encodes the username rather than interpolating it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(PUBLIC_PROFILE)));

    await fetchPublicProfile("../admin");

    // Interpolated raw, this would rewrite the path to /api/v1/admin. The
    // username is validated at registration, but that is a fact about today's
    // validator, not about the string arriving from a URL segment.
    expect(sentRequest().url).toBe(
      "http://api.test/api/v1/users/..%2Fadmin",
    );
  });

  it("reports an unknown username as USER_NOT_FOUND, with the code intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "USER_NOT_FOUND", message: "user not found" } },
          404,
        ),
      ),
    );

    const result = await fetchPublicProfile("nobody");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    // Not normalised to INTERNAL: the profile page has to tell "no such user"
    // (a 404 page) apart from a real failure (an error state).
    expect(result.error.code).toBe("USER_NOT_FOUND");
    expect(result.error.status).toBe(404);
  });
});

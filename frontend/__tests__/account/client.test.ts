import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchCategories,
  fetchMyInterests,
  fetchMyProfile,
  saveMyInterests,
  saveMyProfile,
} from "@/lib/account/client";

/*
 * The browser's calls to this app's own /api/* routes.
 *
 * The rule worth testing hardest is the one that is easiest to get wrong: an
 * unreachable API is NOT a validation failure. If a network blip arrives as an
 * ordinary error, the UI blames what the user typed, and the public profile
 * page renders a 404 for a service that is merely down.
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A fetch stub that answers every request identically.
 *
 * The signature is declared explicitly so `mock.calls[0]` is typed as
 * `[string, RequestInit?]` — without it the mock infers a zero-argument call
 * and the assertions below cannot read the URL or the init.
 */
function stubFetch(response: Response | Error) {
  const mock = vi.fn<(...args: [string, RequestInit?]) => Promise<Response>>(
    async () => {
      if (response instanceof Error) throw response;
      return response;
    },
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function sentBody(mock: ReturnType<typeof vi.fn>): unknown {
  const init = mock.mock.calls[0][1] as RequestInit;
  return init.body === undefined ? undefined : JSON.parse(init.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an unreachable API", () => {
  it("is reported as temporarily unavailable, with status 0", async () => {
    stubFetch(new TypeError("fetch failed"));

    const result = await fetchMyProfile();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    // Status 0 marks "no HTTP response at all" — the signal the UI uses to say
    // "temporarily unavailable" rather than blaming the input.
    expect(result.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(result.error.status).toBe(0);
  });

  it("is never reported as a missing profile", async () => {
    stubFetch(new TypeError("fetch failed"));

    const result = await fetchMyProfile();

    if (result.ok) throw new Error("expected a failure");
    // The public profile page branches on USER_NOT_FOUND to render a 404. A
    // network failure that read as one would show "this user does not exist"
    // for a user who plainly does.
    expect(result.error.code).not.toBe("USER_NOT_FOUND");
  });
});

describe("a response that is not the documented envelope", () => {
  it("becomes MALFORMED_RESPONSE rather than being guessed at", async () => {
    stubFetch(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMyProfile();

    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
    expect(result.error.status).toBe(502);
  });

  it("is treated as malformed when a list key is missing", async () => {
    stubFetch(jsonResponse({ unexpected: [] }));

    const result = await fetchCategories();

    if (result.ok) throw new Error("expected a failure");
    // NOT an empty list. Rendering "no categories" for a response that simply
    // was not what we expected hides a real breakage behind an empty state
    // that looks deliberate.
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("is treated as malformed when a profile has no username", async () => {
    stubFetch(jsonResponse({ id: "x", display_name: "Ada" }));

    const result = await fetchMyProfile();

    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });
});

describe("the backend's own errors", () => {
  it("keep their code and message", async () => {
    stubFetch(
      jsonResponse(
        {
          error: {
            code: "CATEGORY_NOT_FOUND",
            message: "one or more categories do not exist",
          },
        },
        404,
      ),
    );

    const result = await saveMyInterests(["00000000-0000-0000-0000-000000000000"]);

    if (result.ok) throw new Error("expected a failure");
    expect(result.error.code).toBe("CATEGORY_NOT_FOUND");
    expect(result.error.message).toBe("one or more categories do not exist");
  });
});

describe("fetchCategories", () => {
  it("returns the catalogue", async () => {
    stubFetch(jsonResponse({ categories: [CATEGORY] }));

    const result = await fetchCategories();

    expect(result).toEqual({ ok: true, data: [CATEGORY] });
  });
});

describe("fetchMyInterests", () => {
  it("treats an empty list as a valid answer", async () => {
    stubFetch(jsonResponse({ interests: [] }));

    const result = await fetchMyInterests();

    // This is what a user who has not onboarded yet gets, so it must not be
    // an error — the onboarding page would fail for exactly the people it
    // exists for.
    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("saveMyInterests", () => {
  it("PUTs the selection as category_ids, with no de-duplication", async () => {
    const mock = stubFetch(jsonResponse({ interests: [CATEGORY] }));

    await saveMyInterests([CATEGORY.id, CATEGORY.id]);

    expect(mock.mock.calls[0][0]).toBe("/api/me/interests");
    expect((mock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    // Sent as the picker holds it. The backend rejects duplicates rather than
    // collapsing them, and collapsing here would hide that from the user.
    expect(sentBody(mock)).toEqual({ category_ids: [CATEGORY.id, CATEGORY.id] });
  });
});

describe("saveMyProfile", () => {
  it("sends the patch as built, adding no defaults", async () => {
    const mock = stubFetch(jsonResponse(MY_PROFILE));

    await saveMyProfile({ display_name: "Ada Lovelace" });

    expect(mock.mock.calls[0][0]).toBe("/api/me/profile");
    expect((mock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    // Filling in a default bio here would erase a bio the user never touched.
    expect(sentBody(mock)).toEqual({ display_name: "Ada Lovelace" });
  });

  it("carries an empty bio through as a clear", async () => {
    const mock = stubFetch(jsonResponse(MY_PROFILE));

    await saveMyProfile({ bio: "" });

    expect(sentBody(mock)).toEqual({ bio: "" });
  });
});

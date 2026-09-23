/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  createRefreshCoordinator,
  type RefreshOutcome,
} from "@/lib/api/refresh";
import type { SessionTokens } from "@/lib/api/session";
import type { User } from "@/lib/api/types";

/*
 * The coordinator is the module the whole session design rests on, so it is
 * tested directly rather than through a route handler.
 *
 * The behaviour under test is not "does it refresh". It is that a refresh
 * token is never presented to the API twice — because the backend treats a
 * replayed token as theft evidence and revokes the entire session. Every test
 * here is really asserting "one upstream call" or "the old token was not sent
 * again".
 */

const TOKENS: SessionTokens = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
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

const SESSION_OVER: RefreshOutcome = {
  status: "session-over",
  error: new ApiError(
    "INVALID_REFRESH_TOKEN",
    "Refresh token is invalid.",
    401,
  ),
};

const UNAVAILABLE: RefreshOutcome = {
  status: "unavailable",
  error: ApiError.upstreamUnavailable(),
};

describe("createRefreshCoordinator", () => {
  it("collapses concurrent refreshes of one token into a single upstream call", async () => {
    let settle!: (outcome: RefreshOutcome) => void;
    const perform = vi.fn(
      () => new Promise<RefreshOutcome>((resolve) => (settle = resolve)),
    );
    const coordinator = createRefreshCoordinator(perform);

    // All three would otherwise rotate, and the second and third would present
    // a token the first had already consumed.
    const all = Promise.all([
      coordinator.refresh("R1"),
      coordinator.refresh("R1"),
      coordinator.refresh("R1"),
    ]);

    await Promise.resolve();
    expect(perform).toHaveBeenCalledTimes(1);

    settle(REFRESHED);
    const outcomes = await all;

    expect(outcomes).toEqual([REFRESHED, REFRESHED, REFRESHED]);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("answers a request that arrives after the refresh settled without re-presenting the token", async () => {
    const perform = vi.fn(async () => REFRESHED);
    const coordinator = createRefreshCoordinator(perform);

    await coordinator.refresh("R1");

    // The dangerous case: this caller read the old cookie before the refresh
    // finished and only reached here afterwards. An in-flight-only map would
    // have dropped the entry, so this would present a consumed token.
    const late = await coordinator.refresh("R1");

    expect(late).toEqual(REFRESHED);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("does not collapse refreshes of different tokens", async () => {
    const perform = vi.fn(async () => REFRESHED);
    const coordinator = createRefreshCoordinator(perform);

    await Promise.all([
      coordinator.refresh("R1"),
      coordinator.refresh("R2"),
    ]);

    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("reuses a settled outcome only within its retention window", async () => {
    vi.useFakeTimers();
    try {
      const perform = vi.fn(async () => REFRESHED);
      const coordinator = createRefreshCoordinator(perform, {
        settledTtlMs: 1_000,
      });

      await coordinator.refresh("R1");
      vi.advanceTimersByTime(1_001);
      await coordinator.refresh("R1");

      // Past the window the entry is gone, so the token is presented afresh.
      // This is the bound on how long a consumed token's result is remembered.
      expect(perform).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retain an unreachable API, so a later attempt can try again", async () => {
    const perform = vi.fn(async () => UNAVAILABLE);
    const coordinator = createRefreshCoordinator(perform);

    await coordinator.refresh("R1");
    await coordinator.refresh("R1");

    // Nothing was consumed by a failure to reach the API, so remembering it
    // would only deny the next caller a fresh attempt.
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("does not retain a rejected token either", async () => {
    const perform = vi.fn(async () => SESSION_OVER);
    const coordinator = createRefreshCoordinator(perform);

    await coordinator.refresh("R1");
    expect(await coordinator.refresh("R1")).toEqual(SESSION_OVER);

    // A rejected token consumed nothing, so re-presenting it is harmless and
    // re-asking gives the user a way back if the rejection was transient
    // (a revoked session being restored, say). Nothing about the session is
    // decided by this cache.
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejected token from being presented concurrently", async () => {
    let settle!: (outcome: RefreshOutcome) => void;
    const perform = vi.fn(
      () => new Promise<RefreshOutcome>((resolve) => (settle = resolve)),
    );
    const coordinator = createRefreshCoordinator(perform);

    const all = Promise.all([
      coordinator.refresh("R1"),
      coordinator.refresh("R1"),
    ]);
    await Promise.resolve();
    settle(SESSION_OVER);

    expect(await all).toEqual([SESSION_OVER, SESSION_OVER]);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("holds the cache to its size cap by evicting settled entries", async () => {
    const perform = vi.fn(async () => REFRESHED);
    const coordinator = createRefreshCoordinator(perform, { maxEntries: 2 });

    await coordinator.refresh("R1");
    await coordinator.refresh("R2");
    await coordinator.refresh("R3");

    expect(coordinator.size()).toBeLessThanOrEqual(2);
  });

  it("never evicts an in-flight refresh to satisfy the size cap", async () => {
    const resolvers: Array<(outcome: RefreshOutcome) => void> = [];
    const perform = vi.fn(
      () => new Promise<RefreshOutcome>((resolve) => resolvers.push(resolve)),
    );
    const coordinator = createRefreshCoordinator(perform, { maxEntries: 1 });

    // Both are in flight at once and the cap is already exceeded. Evicting
    // either would let a duplicate of that token start a second rotation.
    const all = Promise.all([
      coordinator.refresh("R1"),
      coordinator.refresh("R2"),
    ]);
    await Promise.resolve();

    expect(coordinator.size()).toBe(2);
    expect(perform).toHaveBeenCalledTimes(2);

    // A third call for R1 must still join the original, not start a new one.
    void coordinator.refresh("R1");
    await Promise.resolve();
    expect(perform).toHaveBeenCalledTimes(2);

    resolvers.forEach((resolve) => resolve(REFRESHED));
    await all;
  });

  it("turns an exception from the refresh into an unavailability, not a rejection", async () => {
    const perform = vi.fn(async () => {
      throw new Error("boom");
    });
    const coordinator = createRefreshCoordinator(perform);

    const outcome = await coordinator.refresh("R1");

    // A thrown error is a bug, but it is not evidence the session ended, and
    // it must not escape as an unhandled rejection from a request handler.
    expect(outcome.status).toBe("unavailable");
  });
});

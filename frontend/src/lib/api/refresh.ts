import { createHash } from "node:crypto";

import type { ApiError } from "./errors";
import type { SessionTokens } from "./session";
import { assertServer } from "./server-only";
import type { User } from "./types";

assertServer("src/lib/api/refresh.ts");

/*
 * Refresh coordination.
 *
 * This module exists because of one property of the backend, in
 * internal/services/auth.go: refreshing ROTATES the token, and presenting an
 * already-consumed refresh token is treated as theft evidence that revokes the
 * ENTIRE session. A refresh is therefore not a request that can simply be
 * retried or issued twice. Getting it wrong does not produce a failed call, it
 * produces a forced logout.
 *
 * Two ways that happens, and what is done about each:
 *
 * 1. CONCURRENCY. Two requests arrive holding the same refresh token, both
 *    refresh, the second presents a token the first already consumed. Solved
 *    by deduplicating in flight — and, critically, in the SERVER, not in the
 *    browser. A browser-side single-flight is per-tab, so two tabs would still
 *    race; the server is the only place the duplicate requests meet.
 *
 * 2. STALENESS. A request reads the old cookie, and by the time it reaches
 *    this module the refresh has already completed. An in-flight-only map
 *    would have dropped the entry, so this request would start a SECOND
 *    refresh with the old token — the same replay. Solved by holding a settled
 *    outcome briefly, so a late duplicate is answered with the result that
 *    already happened.
 */

/** How long a settled outcome stays usable for late duplicates. */
export const SETTLED_TTL_MS = 60_000;

/** Upper bound on retained entries, so the cache cannot grow without limit. */
export const MAX_ENTRIES = 500;

export type RefreshSuccess = {
  status: "refreshed";
  tokens: SessionTokens;
  user: User;
};

export type RefreshFailure = {
  /**
   * "session-over" — the backend definitively rejected the refresh token, or
   * the account may no longer authenticate. The session is over.
   *
   * "unavailable" — no verdict was reached: the API was unreachable, timed
   * out, or errored. The session may be perfectly alive.
   */
  status: "session-over" | "unavailable";
  error: ApiError;
};

export type RefreshOutcome = RefreshSuccess | RefreshFailure;

export type RefreshFn = (refreshToken: string) => Promise<RefreshOutcome>;

type Entry = {
  promise: Promise<RefreshOutcome>;
  /** Epoch ms when this settled, or null while still in flight. */
  settledAt: number | null;
  /** Whether a late duplicate may be answered from this entry. */
  reusable: boolean;
};

/**
 * A refresh token is a credential, so it is not used as a cache key directly.
 * The digest is all this module needs to tell two tokens apart, and it keeps
 * live credentials out of a long-lived structure.
 */
function keyFor(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

export type RefreshCoordinator = {
  refresh: (refreshToken: string) => Promise<RefreshOutcome>;
  /** Test seam: how many entries are currently retained. */
  size: () => number;
};

/**
 * Build a coordinator around a `performRefresh` implementation.
 *
 * Injected rather than imported so the concurrency behaviour — the reason this
 * module exists — is testable directly, without a server or a real API.
 */
export function createRefreshCoordinator(
  performRefresh: RefreshFn,
  options: { settledTtlMs?: number; maxEntries?: number } = {},
): RefreshCoordinator {
  const settledTtlMs = options.settledTtlMs ?? SETTLED_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const entries = new Map<string, Entry>();

  /** Drop settled entries whose retention window has passed. */
  function pruneExpired(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.settledAt !== null && now - entry.settledAt > settledTtlMs) {
        entries.delete(key);
      }
    }
  }

  /**
   * Hold the map to its size cap.
   *
   * Only settled entries are ever evicted. Dropping an in-flight one would let
   * a duplicate through and cause exactly the replay this module exists to
   * prevent, so the cap is a bound on retained results and never a reason to
   * forget a refresh that is currently happening.
   */
  function enforceCap(): void {
    if (entries.size <= maxEntries) return;
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) break;
      if (entry.settledAt !== null) entries.delete(key);
    }
  }

  function refresh(refreshToken: string): Promise<RefreshOutcome> {
    const now = Date.now();
    pruneExpired(now);

    const key = keyFor(refreshToken);
    const existing = entries.get(key);

    if (existing) {
      // Still in flight: this caller joins the request already under way
      // rather than starting a second rotation.
      if (existing.settledAt === null) {
        return existing.promise;
      }
      // Already settled and still fresh: a duplicate that arrived too late to
      // join, answered with the outcome that already happened. This is the
      // case that stops a late arrival from replaying a consumed token.
      if (existing.reusable && now - existing.settledAt <= settledTtlMs) {
        return existing.promise;
      }
      entries.delete(key);
    }

    const promise = performRefresh(refreshToken)
      // A refresh that throws instead of returning a verdict is a bug, but it
      // must not become an unhandled rejection or a cached rejected promise.
      // "unavailable" is the safe reading: no verdict means the session is
      // not proven dead.
      .catch(
        (cause: unknown): RefreshOutcome => ({
          status: "unavailable",
          error: {
            name: "ApiError",
            message: String(cause),
          } as ApiError,
        }),
      )
      .then((outcome) => {
        const entry = entries.get(key);
        // Only record the outcome against the entry this call created; a
        // newer entry must not inherit a stale result.
        if (entry && entry.promise === promise) {
          entry.settledAt = Date.now();
          // Only a successful rotation is retained, because only a success
          // consumed the token — and a duplicate presenting a consumed token
          // is what revokes the session. A failure consumed nothing, so
          // repeating it is harmless, and not retaining it means a transient
          // failure is never handed to the next caller in place of a fresh
          // attempt.
          //
          // It also keeps this cache unable to end a session: the retained
          // path can only ever return "refreshed", which writes cookies and
          // clears none. Every clear happens on a failure performed live.
          entry.reusable = outcome.status === "refreshed";
          if (!entry.reusable) {
            entries.delete(key);
          }
        }
        return outcome;
      });

    entries.set(key, { promise, settledAt: null, reusable: false });
    enforceCap();
    return promise;
  }

  return { refresh, size: () => entries.size };
}

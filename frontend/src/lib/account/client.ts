"use client";

import { ApiError, parseApiError } from "@/lib/api/errors";
import type {
  Category,
  MyProfile,
  ProfilePatchRequest,
} from "@/lib/api/types";

/*
 * The browser's calls to this app's own /api/* routes.
 *
 * Same shape and same discipline as `src/lib/auth/client.ts`: nothing here
 * knows the Go API exists, no token is ever attached, and the httpOnly cookies
 * ride along because every request is same-origin.
 *
 * The one rule worth stating, because it is easy to get wrong: an unreachable
 * API returns `UPSTREAM_UNAVAILABLE` with status 0, never a validation or
 * "not found" outcome. "Opueh is down" and "that username does not exist" look
 * identical if a network failure is allowed to become an ordinary error, and
 * the public profile page renders a 404 for one of them.
 */

export type AccountOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function offline(): ApiError {
  // Status 0 marks "no HTTP response at all" — the signal the UI uses to say
  // "temporarily unavailable" rather than blaming what the user typed.
  return ApiError.upstreamUnavailable();
}

type RawResult =
  | { ok: true; body: unknown; status: number }
  | { ok: false; error: ApiError };

async function send(
  path: string,
  init: { method: string; body?: unknown },
): Promise<RawResult> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: offline() };
  }

  const body = await readBody(response);

  if (!response.ok) {
    // The backend's own sentence, passed through the proxy untouched.
    return { ok: false, error: parseApiError(response.status, body) };
  }

  return { ok: true, body, status: response.status };
}

/**
 * Read a list out of an envelope, or report the response as malformed.
 *
 * A missing key is not treated as an empty list. Rendering "no categories" for
 * a response that simply was not what we expected would hide a real breakage
 * behind a plausible-looking empty state.
 */
function listFrom<T>(
  body: unknown,
  key: "categories" | "interests",
  status: number,
): AccountOutcome<T[]> {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  if (!Array.isArray(value)) {
    return { ok: false, error: parseApiError(status, undefined) };
  }
  return { ok: true, data: value as T[] };
}

/** `GET /api/categories` — the selectable taxonomy. */
export async function fetchCategories(): Promise<AccountOutcome<Category[]>> {
  const result = await send("/api/categories", { method: "GET" });
  if (!result.ok) return result;

  return listFrom<Category>(result.body, "categories", result.status);
}

/** `GET /api/me/interests` — what this user has chosen. Empty is valid. */
export async function fetchMyInterests(): Promise<AccountOutcome<Category[]>> {
  const result = await send("/api/me/interests", { method: "GET" });
  if (!result.ok) return result;

  return listFrom<Category>(result.body, "interests", result.status);
}

/**
 * `PUT /api/me/interests` — replace the whole selection.
 *
 * No de-duplication and no count check here: the backend rejects duplicates
 * outright rather than collapsing them, and it owns the 1–10 rule. Sending the
 * selection as the picker holds it is what makes its message match the UI.
 */
export async function saveMyInterests(
  categoryIds: string[],
): Promise<AccountOutcome<Category[]>> {
  const result = await send("/api/me/interests", {
    method: "PUT",
    body: { category_ids: categoryIds },
  });
  if (!result.ok) return result;

  return listFrom<Category>(result.body, "interests", result.status);
}

/** `GET /api/me/profile`. */
export async function fetchMyProfile(): Promise<AccountOutcome<MyProfile>> {
  const result = await send("/api/me/profile", { method: "GET" });
  if (!result.ok) return result;

  return profileFrom<MyProfile>(result.body, result.status);
}

/**
 * `PATCH /api/me/profile` — send only the fields that changed.
 *
 * An omitted field is left alone upstream while an empty string clears it, so
 * the patch object is passed through as the caller built it. Nothing is filled
 * in with a default here; doing so would erase fields the user never touched.
 */
export async function saveMyProfile(
  patch: ProfilePatchRequest,
): Promise<AccountOutcome<MyProfile>> {
  const result = await send("/api/me/profile", { method: "PATCH", body: patch });
  if (!result.ok) return result;

  return profileFrom<MyProfile>(result.body, result.status);
}

function profileFrom<T>(body: unknown, status: number): AccountOutcome<T> {
  if (typeof body !== "object" || body === null || !("username" in body)) {
    return { ok: false, error: parseApiError(status, undefined) };
  }
  return { ok: true, data: body as T };
}

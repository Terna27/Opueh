import {
  apiFetch,
  requestUpstream,
  type RefreshOnce,
  type UpstreamResult,
} from "./client";
import { assertServer } from "./server-only";
import type {
  CategoryList,
  InterestList,
  ReplaceInterestsRequest,
} from "./types";

assertServer("src/lib/api/categories.ts");

/*
 * The Go API's category and interest endpoints.
 *
 * Paths are copied from internal/routes/routes.go, as in `auth.ts`.
 *
 * `listCategories` is the only genuinely public call in this module, but it
 * still goes through the proxy rather than being fetched from the browser:
 * there is no API origin in the client bundle, and reaching for one would undo
 * the M4 decision that keeps `API_BASE_URL` server-only.
 */

/** `GET /api/v1/categories` — the selectable taxonomy. Public. */
export function listCategories(): Promise<UpstreamResult<CategoryList>> {
  return requestUpstream<CategoryList>({
    path: "/api/v1/categories",
    method: "GET",
  });
}

/**
 * `GET /api/v1/me/interests` — what this user has chosen.
 *
 * An empty list is a valid answer, not a missing one: it is what a user who
 * has not onboarded yet gets, and it is why onboarding completeness cannot be
 * inferred from this endpoint alone.
 */
export function fetchMyInterests(
  accessToken: string,
  refresh?: RefreshOnce,
): Promise<UpstreamResult<InterestList>> {
  return apiFetch<InterestList>(
    {
      path: "/api/v1/me/interests",
      method: "GET",
      accessToken,
    },
    refresh,
  );
}

/**
 * `PUT /api/v1/me/interests` — replace the whole set.
 *
 * The body is built field by field rather than forwarded, like every other
 * upstream call here: the handler decodes with `DisallowUnknownFields()`, so a
 * stray key is a 400 and a body the client controls is a body the client can
 * add fields to.
 */
export function replaceMyInterests(
  accessToken: string,
  input: ReplaceInterestsRequest,
  refresh?: RefreshOnce,
): Promise<UpstreamResult<InterestList>> {
  return apiFetch<InterestList>(
    {
      path: "/api/v1/me/interests",
      method: "PUT",
      accessToken,
      body: { category_ids: input.category_ids },
    },
    refresh,
  );
}

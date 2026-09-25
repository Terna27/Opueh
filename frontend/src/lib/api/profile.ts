import {
  apiFetch,
  requestUpstream,
  type RefreshOnce,
  type UpstreamResult,
} from "./client";
import { assertServer } from "./server-only";
import type { MyProfile, ProfilePatchRequest, PublicProfile } from "./types";

assertServer("src/lib/api/profile.ts");

/*
 * The Go API's profile endpoints.
 *
 * Paths are copied from internal/routes/routes.go and the bodies from the
 * structs in internal/handlers/profile.go.
 *
 * Both profile responses are BARE upstream — `{id, username, ...}`, with no
 * wrapper. Any envelope the browser sees is added by the proxy route, as M4
 * does for `{user}`.
 */

/** `GET /api/v1/me/profile` — the signed-in user's own profile. */
export function fetchMyProfile(
  accessToken: string,
  refresh?: RefreshOnce,
): Promise<UpstreamResult<MyProfile>> {
  return apiFetch<MyProfile>(
    {
      path: "/api/v1/me/profile",
      method: "GET",
      accessToken,
    },
    refresh,
  );
}

/**
 * `PATCH /api/v1/me/profile` — update display name and/or bio.
 *
 * A field is included only when the caller supplied one. That is not tidiness:
 * upstream the struct fields are pointers, so an omitted `bio` leaves the
 * existing bio alone while `bio: ""` erases it. Sending `bio: ""` for a field
 * the user never touched would silently delete their bio on every save.
 *
 * The "at least one field" rule is the backend's to state. It is not
 * duplicated here — a patch with nothing in it is sent as an empty object and
 * comes back as the backend's own validation error.
 */
export function updateMyProfile(
  accessToken: string,
  patch: ProfilePatchRequest,
  refresh?: RefreshOnce,
): Promise<UpstreamResult<MyProfile>> {
  const body: Record<string, string> = {};
  if (patch.display_name !== undefined) {
    body.display_name = patch.display_name;
  }
  if (patch.bio !== undefined) {
    body.bio = patch.bio;
  }

  return apiFetch<MyProfile>(
    {
      path: "/api/v1/me/profile",
      method: "PATCH",
      accessToken,
      body,
    },
    refresh,
  );
}

/**
 * `GET /api/v1/users/{username}` — anyone's public profile. No token.
 *
 * The username is encoded rather than interpolated. It is validated to
 * `[A-Za-z0-9_]` at registration, but that is a fact about today's validator,
 * not a property of the string arriving here from a URL segment — and a
 * username of `..%2f` reaching this line would otherwise rewrite the path.
 *
 * An unknown, deleted, suspended or banned username all come back as
 * `USER_NOT_FOUND`, deliberately indistinguishable. Callers should branch on
 * that code through `isProfileMissing` rather than reading the message.
 */
export function fetchPublicProfile(
  username: string,
): Promise<UpstreamResult<PublicProfile>> {
  return requestUpstream<PublicProfile>({
    path: `/api/v1/users/${encodeURIComponent(username)}`,
    method: "GET",
  });
}

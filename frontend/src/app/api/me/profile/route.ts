import { ApiError } from "@/lib/api/errors";
import { fetchMyProfile, updateMyProfile } from "@/lib/api/profile";
import {
  checkSameOrigin,
  errorResponse,
  jsonResponse,
  optionalStringField,
  readJsonObject,
} from "@/lib/api/proxy";
import { readSessionCookies, refreshSession } from "@/lib/api/session";

/*
 * GET   /api/me/profile — the signed-in user's own profile.
 * PATCH /api/me/profile — update display name and/or bio.
 *
 * Guarded, like /api/me/interests. The upstream response is a BARE profile
 * object — no `{profile: ...}` wrapper — and it is passed through that way, so
 * `MyProfile` describes one shape on both sides of the proxy.
 */

export async function GET(): Promise<Response> {
  const { accessToken } = await readSessionCookies();
  if (!accessToken) {
    return errorResponse(ApiError.unauthenticated());
  }

  const result = await fetchMyProfile(accessToken, refreshSession);

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return jsonResponse(result.data);
}

/*
 * The body is assembled from whichever fields the client actually sent.
 *
 * `optionalStringField` returns undefined for a field that is absent, and
 * `updateMyProfile` then omits the key entirely. That is load-bearing rather
 * than stylistic: upstream the struct fields are pointers, so an absent `bio`
 * leaves the existing one alone while `bio: ""` erases it. Defaulting a
 * missing field to "" would delete a user's bio every time they saved a new
 * display name.
 *
 * The "at least one field" rule is not enforced here. A patch with nothing in
 * it is forwarded as an empty object and rejected by the backend in its own
 * words, so the rule lives in exactly one place.
 */
export async function PATCH(request: Request): Promise<Response> {
  const originError = checkSameOrigin(request);
  if (originError) {
    return errorResponse(originError);
  }

  const { accessToken } = await readSessionCookies();
  if (!accessToken) {
    return errorResponse(ApiError.unauthenticated());
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return errorResponse(parsed.error);
  }

  const result = await updateMyProfile(
    accessToken,
    {
      display_name: optionalStringField(parsed.body, "display_name"),
      bio: optionalStringField(parsed.body, "bio"),
    },
    refreshSession,
  );

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return jsonResponse(result.data);
}

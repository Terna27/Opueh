import { fetchMyInterests, replaceMyInterests } from "@/lib/api/categories";
import { ApiError } from "@/lib/api/errors";
import {
  checkSameOrigin,
  errorResponse,
  jsonResponse,
  readJsonObject,
  stringArrayField,
} from "@/lib/api/proxy";
import { readSessionCookies, refreshSession } from "@/lib/api/session";

/*
 * GET  /api/me/interests — what the signed-in user has chosen.
 * PUT  /api/me/interests — replace the whole set.
 *
 * Both are guarded: without an access cookie the API would answer 401, and a
 * refresh would have nothing to present either, so the request is refused
 * before it is made.
 *
 * The upstream `{interests: [...]}` envelope is passed through unchanged, and
 * an empty list is a valid answer rather than an error — it is what a user who
 * has not onboarded yet gets.
 */

export async function GET(): Promise<Response> {
  const { accessToken } = await readSessionCookies();
  if (!accessToken) {
    return errorResponse(ApiError.unauthenticated());
  }

  const result = await fetchMyInterests(accessToken, refreshSession);

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return jsonResponse(result.data);
}

/*
 * PUT is mutating, so it carries the Origin check. The cookies ride along
 * automatically, which is exactly what makes a cross-site request dangerous
 * here: a page on another origin could otherwise replace a user's interests
 * without ever seeing a token.
 */
export async function PUT(request: Request): Promise<Response> {
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

  // The count, UUID and duplicate rules all belong to the backend's service
  // layer. Nothing is validated here beyond the shape of the body, so there is
  // one authority on what a valid selection is and no second copy to drift.
  const result = await replaceMyInterests(
    accessToken,
    { category_ids: stringArrayField(parsed.body, "category_ids") },
    refreshSession,
  );

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return jsonResponse(result.data);
}

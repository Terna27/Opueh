import { fetchCurrentUser } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { errorResponse, sessionResponse } from "@/lib/api/proxy";
import { readSessionCookies, refreshSession } from "@/lib/api/session";

/*
 * GET /api/auth/me
 *
 * How the browser learns whether it is signed in. Called on page load, so its
 * cost matters: the refresh hook makes an expired access cookie rotate and
 * retry once, which is what lets a session survive a reload without the user
 * ever seeing a login screen.
 *
 * No Origin check — this is a safe method with no side effect performed on the
 * caller's behalf, and requiring an Origin header would reject a plain
 * navigation.
 */
export async function GET(): Promise<Response> {
  const { accessToken } = await readSessionCookies();

  if (!accessToken) {
    // No point asking: the API would answer 401, and the refresh would have
    // nothing to present either. Reported with the code the API uses, so the
    // client has one thing to recognise.
    return errorResponse(
      new ApiError("UNAUTHENTICATED", "You are not signed in.", 401),
    );
  }

  const result = await fetchCurrentUser(accessToken, refreshSession);

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return sessionResponse(result.data);
}

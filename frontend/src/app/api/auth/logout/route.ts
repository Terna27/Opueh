import { logoutSession } from "@/lib/api/auth";
import { type ApiError, isAlreadySignedOut } from "@/lib/api/errors";
import { checkSameOrigin, errorResponse } from "@/lib/api/proxy";
import {
  clearSessionCookies,
  readSessionCookies,
  refreshSession,
} from "@/lib/api/session";

/*
 * POST /api/auth/logout
 *
 * ORDERING IS A CORRECTNESS PROPERTY HERE, NOT STYLE — read this before
 * changing it.
 *
 * The upstream revoke happens FIRST; the cookies are cleared after. That
 * ordering is what makes a logout racing an in-flight refresh safe. A refresh
 * that is already running can write a fresh token pair after this handler has
 * cleared them, which looks like a resurrected session. It is not one, because
 * the session was revoked in the database before those cookies were written:
 * the backend re-checks session state on both `Authenticate` and `Refresh`, so
 * the resurrected cookies are inert and the next request clears them again.
 *
 * Clearing the cookies first — the obvious ordering — would instead leave a
 * live session on the server that the user believes they ended.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = checkSameOrigin(request);
  if (originError) {
    return errorResponse(originError);
  }

  const { accessToken } = await readSessionCookies();

  let revokeError: ApiError | null = null;

  if (accessToken) {
    // `logoutSession` refreshes and retries once, so a logout with an expired
    // access token still reaches the revoke instead of silently failing and
    // leaving the session alive.
    const result = await logoutSession(accessToken, refreshSession);

    if (!result.ok && !isAlreadySignedOut(result.error)) {
      revokeError = result.error;
    }
  }

  await clearSessionCookies();

  if (revokeError) {
    // The cookies are gone, so the browser is signed out either way; this
    // reports that the server's copy may still be alive. Hiding it would leave
    // the user believing a session was ended when it was not.
    return errorResponse(revokeError);
  }

  return new Response(null, { status: 204 });
}

import {
  checkSameOrigin,
  errorResponse,
  sessionResponse,
} from "@/lib/api/proxy";
import { refreshSession } from "@/lib/api/session";

/*
 * POST /api/auth/refresh
 *
 * The one route that rotates a refresh token, and the only entry point to
 * `refreshSession`. Everything difficult about that lives in
 * `src/lib/api/refresh.ts`; this handler is the thin glue turning its three
 * outcomes into three responses.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = checkSameOrigin(request);
  if (originError) {
    return errorResponse(originError);
  }

  const outcome = await refreshSession();

  if (outcome.status === "refreshed") {
    return sessionResponse(outcome.user);
  }

  // "session-over" surfaces the backend's own 401/403, and "unavailable"
  // becomes a 503 via `httpStatusFor`. The client depends on that difference:
  // one means sign out, the other means try again later.
  return errorResponse(outcome.error);
}

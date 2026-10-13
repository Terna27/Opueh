import { registerUser } from "@/lib/api/auth";
import {
  checkSameOrigin,
  errorResponse,
  readJsonObject,
  sessionResponse,
  stringField,
} from "@/lib/api/proxy";
import {
  tokensFromAuthResponse,
  writeSessionCookies,
} from "@/lib/api/session";

/*
 * POST /api/auth/register
 *
 * Creates an account and signs the new user in — the API already returns a
 * token pair on register, so there is no reason to make them log in again.
 *
 * The browser receives `{user}` and two httpOnly cookies. The tokens are
 * never in the body.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = checkSameOrigin(request);
  if (originError) {
    return errorResponse(originError);
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return errorResponse(parsed.error);
  }

  const result = await registerUser({
    email: stringField(parsed.body, "email"),
    username: stringField(parsed.body, "username"),
    password: stringField(parsed.body, "password"),
    display_name: stringField(parsed.body, "display_name"),
  });

  if (!result.ok) {
    // Passed through untouched: the backend's VALIDATION_ERROR message is the
    // contract, and rewording it here would create a second copy to keep in
    // sync. Nothing is stored on a failed register.
    return errorResponse(result.error);
  }

  await writeSessionCookies(tokensFromAuthResponse(result.data));

  // 201, matching the API.
  return sessionResponse(result.data.user, 201);
}

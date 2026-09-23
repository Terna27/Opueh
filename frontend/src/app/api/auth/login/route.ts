import { loginUser } from "@/lib/api/auth";
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
 * POST /api/auth/login
 *
 * A 401 here is `INVALID_CREDENTIALS` — nothing about an existing session —
 * so this handler never refreshes and never clears cookies that were already
 * there. It only writes a pair once the API has authenticated the user.
 *
 * `identifier` is email or username; the backend accepts either, and the form
 * passes through whatever was typed.
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

  const result = await loginUser({
    identifier: stringField(parsed.body, "identifier"),
    password: stringField(parsed.body, "password"),
  });

  if (!result.ok) {
    return errorResponse(result.error);
  }

  await writeSessionCookies(tokensFromAuthResponse(result.data));

  return sessionResponse(result.data.user);
}

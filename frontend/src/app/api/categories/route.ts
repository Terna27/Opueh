import { listCategories } from "@/lib/api/categories";
import { errorResponse, jsonResponse } from "@/lib/api/proxy";

/*
 * GET /api/categories
 *
 * Public — the taxonomy is not sensitive and the signup flow needs it. It
 * still goes through this proxy rather than being fetched from the browser
 * directly, because there is no API origin in the client bundle: `API_BASE_URL`
 * is server-only by design.
 *
 * The upstream envelope `{categories: [...]}` is passed through unchanged. The
 * browser's shape is this handler's decision, and here it is also the
 * upstream's — reshaping a list into a list would add a mapping to keep in
 * sync and buy nothing.
 *
 * No Origin check: a safe method with no side effect on the caller's behalf.
 */
export async function GET(): Promise<Response> {
  const result = await listCategories();

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return jsonResponse(result.data);
}

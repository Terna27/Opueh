/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  ApiError,
  type ApiErrorCode,
  httpStatusFor,
  isAccessTokenRejected,
  isAlreadySignedOut,
  isProfileMissing,
  isSessionOver,
  parseApiError,
} from "@/lib/api/errors";

describe("parseApiError", () => {
  it("reads the API's envelope", () => {
    const error = parseApiError(400, {
      error: { code: "VALIDATION_ERROR", message: "username is required" },
    });

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("username is required");
    expect(error.status).toBe(400);
  });

  it("refuses a body that is not the envelope", () => {
    // The actual text of a gateway error page must never be presented as
    // though the API had said it.
    expect(parseApiError(502, "<html>Bad Gateway</html>").code).toBe(
      "MALFORMED_RESPONSE",
    );
    expect(parseApiError(502, null).code).toBe("MALFORMED_RESPONSE");
    expect(parseApiError(502, { message: "no wrapper" }).code).toBe(
      "MALFORMED_RESPONSE",
    );
    expect(parseApiError(502, { error: "not an object" }).code).toBe(
      "MALFORMED_RESPONSE",
    );
  });

  it("preserves the message when the code is unrecognised", () => {
    const error = parseApiError(409, {
      error: { code: "SOMETHING_NEW", message: "A code this app has not seen" },
    });

    // A code added upstream later must not lose the backend's explanation,
    // and must not be mistaken for a code that carries meaning here.
    expect(error.code).toBe("INTERNAL");
    expect(error.message).toBe("A code this app has not seen");
  });

  it("keeps the two codes the profile and category endpoints branch on", () => {
    // Without these in the union both would collapse to INTERNAL, and the
    // public profile page — which renders a 404 for USER_NOT_FOUND — would
    // show "an unexpected error occurred" for an ordinary miss.
    const missingUser = parseApiError(404, {
      error: { code: "USER_NOT_FOUND", message: "user not found" },
    });
    expect(missingUser.code).toBe("USER_NOT_FOUND");

    const missingCategory = parseApiError(404, {
      error: { code: "CATEGORY_NOT_FOUND", message: "category not found" },
    });
    expect(missingCategory.code).toBe("CATEGORY_NOT_FOUND");
  });
});

describe("isProfileMissing", () => {
  it("reads a missing user as a missing profile", () => {
    expect(
      isProfileMissing(
        new ApiError("USER_NOT_FOUND", "user not found", 404),
      ),
    ).toBe(true);
    // What a routing-layer miss would produce, rather than the handler's own.
    expect(isProfileMissing(new ApiError("NOT_FOUND", "not found", 404))).toBe(
      true,
    );
  });

  it("does not read a failure as a missing profile", () => {
    // The distinction the profile page turns into a 404 page versus an error
    // state. "This user does not exist" and "Opueh is down" are not the same
    // sentence to a reader.
    expect(
      isProfileMissing(ApiError.upstreamUnavailable()),
    ).toBe(false);
    expect(isProfileMissing(new ApiError("INTERNAL", "boom", 500))).toBe(false);
    expect(
      isProfileMissing(new ApiError("UNAUTHENTICATED", "nope", 401)),
    ).toBe(false);
  });
});

describe("classification", () => {
  it("treats any 401 on a protected request as a rejected access token", () => {
    // Keyed on the status, not the code, so a new 401 code added upstream
    // cannot quietly switch silent refreshing off.
    expect(isAccessTokenRejected(new ApiError("INVALID_TOKEN", "x", 401))).toBe(
      true,
    );
    expect(isAccessTokenRejected(new ApiError("UNAUTHENTICATED", "x", 401))).toBe(
      true,
    );
    expect(isAccessTokenRejected(new ApiError("SOMETHING" as ApiErrorCode, "x", 401))).toBe(
      true,
    );
    expect(isAccessTokenRejected(new ApiError("INTERNAL", "x", 500))).toBe(
      false,
    );
  });

  it("only lets the backend declare a session over", () => {
    expect(
      isSessionOver(new ApiError("INVALID_REFRESH_TOKEN", "x", 401)),
    ).toBe(true);
    expect(isSessionOver(new ApiError("ACCOUNT_SUSPENDED", "x", 403))).toBe(
      true,
    );
    expect(isSessionOver(new ApiError("ACCOUNT_BANNED", "x", 403))).toBe(true);

    // An unreachable API reached no verdict about the session.
    expect(isSessionOver(ApiError.upstreamUnavailable())).toBe(false);
    expect(isSessionOver(new ApiError("INTERNAL", "x", 500))).toBe(false);
    expect(isSessionOver(ApiError.malformedResponse(502))).toBe(false);
  });

  it("reads an already-dead session as nothing left to revoke", () => {
    expect(isAlreadySignedOut(new ApiError("UNAUTHENTICATED", "x", 401))).toBe(
      true,
    );
    expect(isAlreadySignedOut(new ApiError("ACCOUNT_SUSPENDED", "x", 403))).toBe(
      true,
    );
    // A real failure to revoke must not be mistaken for a clean logout.
    expect(isAlreadySignedOut(ApiError.upstreamUnavailable())).toBe(false);
    expect(isAlreadySignedOut(new ApiError("INTERNAL", "x", 500))).toBe(false);
  });
});

describe("httpStatusFor", () => {
  it("answers 503 when no response ever arrived", () => {
    // Status 0 means the request never reached an HTTP server, so there is no
    // upstream status to pass on. 503 says "try again"; 401 would wrongly tell
    // the browser the session ended.
    expect(httpStatusFor(ApiError.upstreamUnavailable())).toBe(503);
  });

  it("passes a real status through", () => {
    expect(httpStatusFor(new ApiError("INVALID_CREDENTIALS", "x", 401))).toBe(
      401,
    );
    expect(httpStatusFor(ApiError.malformedResponse(502))).toBe(502);
    expect(httpStatusFor(ApiError.forbiddenOrigin())).toBe(403);
  });
});

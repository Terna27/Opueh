import { describe, expect, test } from "vitest";

import { normalizeApiBaseUrl } from "@/lib/env";

describe("normalizeApiBaseUrl", () => {
  test("falls back to the local API origin when unset outside production", () => {
    expect(normalizeApiBaseUrl(undefined, "development")).toBe(
      "http://localhost:8080",
    );
    expect(normalizeApiBaseUrl("", "test")).toBe("http://localhost:8080");
    expect(normalizeApiBaseUrl("   ", "development")).toBe(
      "http://localhost:8080",
    );
  });

  test("refuses to build for production without an API origin", () => {
    // Silently pointing a production bundle at localhost is worse than
    // failing the build.
    expect(() => normalizeApiBaseUrl(undefined, "production")).toThrow(
      /NEXT_PUBLIC_API_BASE_URL is required in production/,
    );
  });

  test("strips trailing slashes so path joining is unambiguous", () => {
    expect(normalizeApiBaseUrl("http://localhost:8080/", "development")).toBe(
      "http://localhost:8080",
    );
    expect(normalizeApiBaseUrl("https://api.opueh.com///", "production")).toBe(
      "https://api.opueh.com",
    );
  });

  test("preserves a base path", () => {
    expect(normalizeApiBaseUrl("https://api.opueh.com/v1", "production")).toBe(
      "https://api.opueh.com/v1",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(
      normalizeApiBaseUrl("  http://localhost:8080  ", "development"),
    ).toBe("http://localhost:8080");
  });

  test("rejects a value that is not an absolute URL", () => {
    expect(() => normalizeApiBaseUrl("/api", "development")).toThrow(
      /must be an absolute URL/,
    );
    expect(() => normalizeApiBaseUrl("opueh.com", "development")).toThrow(
      /must be an absolute URL/,
    );
  });

  test("rejects a bare host:port, which URL parsing misreads as a scheme", () => {
    // `new URL("localhost:8080")` succeeds with "localhost" as the scheme, so
    // this would otherwise slip through and resolve to the origin "null".
    expect(() => normalizeApiBaseUrl("localhost:8080", "development")).toThrow(
      /must use the http or https scheme/,
    );
    expect(() => normalizeApiBaseUrl("ftp://localhost:8080", "development")).toThrow(
      /must use the http or https scheme/,
    );
  });

  test("rejects a base URL that embeds credentials", () => {
    // NEXT_PUBLIC_ values are inlined into the browser bundle, so anything
    // here is public and must never carry a secret.
    expect(() =>
      normalizeApiBaseUrl("https://user:secret@api.opueh.com", "production"),
    ).toThrow(/must not embed credentials/);
  });

  test("rejects a base URL carrying a query string or fragment", () => {
    expect(() =>
      normalizeApiBaseUrl("http://localhost:8080?debug=1", "development"),
    ).toThrow(/must not contain a query string or fragment/);
    expect(() =>
      normalizeApiBaseUrl("http://localhost:8080#top", "development"),
    ).toThrow(/must not contain a query string or fragment/);
  });
});

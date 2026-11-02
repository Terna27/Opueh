/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { checkSameOrigin } from "@/lib/api/proxy";

function request(url: string, origin?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: origin === undefined ? {} : { origin },
  });
}

describe("checkSameOrigin", () => {
  it("accepts a request from the exact origin", () => {
    expect(checkSameOrigin(request("https://app.example.com/api/auth/login", "https://app.example.com"))).toBeNull();
  });

  it("rejects a missing origin", () => {
    expect(checkSameOrigin(request("https://app.example.com/api/auth/login"))).not.toBeNull();
  });

  it("rejects an invalid or opaque origin", () => {
    expect(checkSameOrigin(request("https://app.example.com/api/auth/login", "null"))).not.toBeNull();
  });

  it("rejects a different host", () => {
    expect(checkSameOrigin(request("https://app.example.com/api/auth/login", "https://evil.example.com"))).not.toBeNull();
  });

  it("rejects a different scheme on the same host", () => {
    expect(checkSameOrigin(request("https://app.example.com/api/auth/login", "http://app.example.com"))).not.toBeNull();
  });

  it("rejects a different port on the same host", () => {
    expect(checkSameOrigin(request("http://localhost:3000/api/auth/login", "http://localhost:3001"))).not.toBeNull();
  });
});

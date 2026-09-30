import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api, getSession, setSession } from "./api";
import type { AuthResult } from "./api";
const original: AuthResult = {
  user: {
    id: "1",
    username: "tester",
    display_name: "Tester",
    email: "test@example.com",
    email_verified: false,
  },
  access_token: "old",
  refresh_token: "refresh-old",
  expires_in: 900,
};
const rotated = {
  ...original,
  access_token: "new",
  refresh_token: "refresh-new",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  setSession(null);
});
afterEach(() => vi.unstubAllGlobals());
describe("API contract and session refresh", () => {
  it("shows backend validation messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          { error: { code: "VALIDATION_ERROR", message: "Invalid username" } },
          400,
        ),
      ),
    );
    await expect(api("/auth/register")).rejects.toThrow("Invalid username");
  });
  it("coalesces concurrent refreshes and uses rotated credentials", async () => {
    setSession(original);
    let refreshCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/auth/refresh")) {
          refreshCount++;
          expect(JSON.parse(String(init.body)).refresh_token).toBe(
            "refresh-old",
          );
          await new Promise((resolve) => setTimeout(resolve, 10));
          return response(rotated);
        }
        if (new Headers(init.headers).get("Authorization") === "Bearer old")
          return response({ error: { message: "Expired" } }, 401);
        return response({ ok: true });
      }),
    );
    await expect(
      Promise.all([
        api("/me/profile", {}, true),
        api("/me/interests", {}, true),
      ]),
    ).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCount).toBe(1);
    expect(getSession()?.refresh_token).toBe("refresh-new");
  });
  it("clears revoked sessions", async () => {
    setSession(original);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          { error: { code: "UNAUTHENTICATED", message: "Revoked" } },
          401,
        ),
      ),
    );
    await expect(api("/me/profile", {}, true)).rejects.toThrow("Revoked");
    expect(getSession()).toBeNull();
  });
  it("does not refresh after a permission denial", async () => {
    setSession(original);
    const fetch = vi.fn(async () =>
      response({ error: { message: "Not allowed" } }, 403),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(api("/me/profile", {}, true)).rejects.toThrow("Not allowed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("handles logout without JSON", async () => {
    setSession(original);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(
      api("/auth/logout", { method: "POST" }, true),
    ).resolves.toBeUndefined();
  });
  it("does not restore a session after logout while refresh is in flight", async () => {
    setSession(original);
    let release: (value: Response) => void = () => {};
    let started: () => void = () => {};
    const waiting = new Promise<void>((r) => {
      started = r;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/refresh")) {
          started();
          return new Promise<Response>((r) => {
            release = r;
          });
        }
        return response({ error: { message: "Expired" } }, 401);
      }),
    );
    const pending = api("/me/profile", {}, true);
    const rejection = expect(pending).rejects.toThrow("session changed");
    await waiting;
    setSession(null);
    release(response(rotated));
    await rejection;
    expect(getSession()).toBeNull();
  });
});

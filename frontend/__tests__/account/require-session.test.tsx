import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RequireSession } from "@/components/account/require-session";
import { SessionProvider } from "@/lib/auth/session-context";

/*
 * The guard for authenticated pages.
 *
 * Middleware answers a cheaper question first, so this is where the real one
 * gets asked. Its three states have to stay genuinely distinct, and the two
 * failures worth guarding against are opposite mistakes:
 *
 *   - redirecting while LOADING, which bounces a signed-in user to the login
 *     page on every hard refresh
 *   - treating an UNREACHABLE API as signed-out, which logs people out
 *     whenever Opueh hiccups
 */

const { replaceMock, pushMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => "/settings/profile",
}));

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  username: "ada",
  display_name: "Ada",
  email: "ada@example.com",
  role: "USER",
  status: "ACTIVE",
  email_verified: false,
  created_at: "2026-01-01T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answer /api/auth/me however this test needs. */
function stubSession(response: Response | Error | (() => Promise<Response>)) {
  const mock = vi.fn(async () => {
    if (typeof response === "function") return response();
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function renderGuard(children: ReactNode = <p>Secret content</p>) {
  return render(
    <SessionProvider>
      <RequireSession>{children}</RequireSession>
    </SessionProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  replaceMock.mockClear();
  pushMock.mockClear();
});

describe("RequireSession", () => {
  it("renders the children once the session is confirmed", async () => {
    stubSession(jsonResponse({ user: USER }));

    renderGuard();

    expect(await screen.findByText("Secret content")).toBeDefined();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows a placeholder while the session is loading, and does not redirect", async () => {
    // Never resolves: this is the first paint, before the answer arrives.
    stubSession(() => new Promise<Response>(() => {}));

    renderGuard();

    expect(screen.getByText("Loading your account")).toBeDefined();
    expect(screen.queryByText("Secret content")).toBeNull();
    // The important half. Redirecting here would bounce a signed-in user to
    // the login page on every hard refresh.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects a signed-out visitor to login, carrying where they were going", async () => {
    stubSession(
      jsonResponse(
        { error: { code: "UNAUTHENTICATED", message: "You are not signed in." } },
        401,
      ),
    );

    renderGuard();

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        "/login?next=%2Fsettings%2Fprofile",
      ),
    );
    // Replace, not push: the protected URL should not be left in history for
    // the back button to return to once the user has been bounced off it.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a placeholder rather than a login form while the redirect is in flight", async () => {
    stubSession(
      jsonResponse(
        { error: { code: "UNAUTHENTICATED", message: "You are not signed in." } },
        401,
      ),
    );

    renderGuard();

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    // The protected content must never appear, not even for a frame.
    expect(screen.queryByText("Secret content")).toBeNull();
  });

  it("reports an unreachable API with a retry, and does NOT redirect", async () => {
    stubSession(new TypeError("fetch failed"));

    renderGuard();

    expect(
      await screen.findByText("Opueh is temporarily unavailable"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    // An unreachable API says nothing about the session. Redirecting to login
    // here would sign people out whenever the backend hiccups — and their
    // credentials would not be the problem.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("asks again when Try again is pressed", async () => {
    const mock = stubSession(new TypeError("fetch failed"));

    renderGuard();
    await screen.findByText("Opueh is temporarily unavailable");

    const before = mock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(mock.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("lets the user in after a retry that succeeds", async () => {
    let attempt = 0;
    stubSession(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(jsonResponse({ user: USER }));
    });

    renderGuard();
    await screen.findByText("Opueh is temporarily unavailable");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    // The retry has to be able to change the outcome, not just re-render the
    // same error — otherwise the button is decoration.
    expect(await screen.findByText("Secret content")).toBeDefined();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

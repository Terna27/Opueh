import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";

import { renderWithSession } from "../support/session";

/*
 * The forms, against a stubbed /api/auth/*.
 *
 * What matters here is which message the user ends up reading. The backend
 * sends one string per error with no per-field detail, so the form must show
 * it verbatim rather than guessing which field it referred to — and it must
 * not turn "the API is down" into "your password is wrong".
 */

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

type Route = (init: RequestInit | undefined) => Response;

/** Route stubbed responses by URL; anything unrouted is a test bug. */
function stubRoutes(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") {
      return new Response(
        JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "You are not signed in." },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    const route = routes[url];
    if (!route) throw new Error(`unstubbed request: ${url}`);
    return route(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

/** The parsed body of the first request to a given URL. */
function bodySentTo(fetchMock: ReturnType<typeof vi.fn>, url: string) {
  const call = fetchMock.mock.calls.find(([called]) => called === url);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

function fill(label: string, value: string) {
  // `exact: false` because a required field's label carries a decorative "*"
  // in a child span, so its text content is "Password*", not "Password".
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button"));
}

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  test("asks for the fields before making a request", async () => {
    const fetchMock = stubRoutes({});
    renderWithSession(<LoginForm />);

    submit();

    expect(await screen.findByText("Enter your email or username.")).toBeDefined();
    expect(screen.getByText("Password is required.")).toBeDefined();
    // Nothing but the session probe should have gone out.
    expect(
      fetchMock.mock.calls.filter(([url]) => url !== "/api/auth/me"),
    ).toHaveLength(0);
  });

  test("shows the backend's message when the credentials are wrong", async () => {
    stubRoutes({
      "/api/auth/login": () =>
        json(
          { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
          401,
        ),
    });
    renderWithSession(<LoginForm />);

    fill("Email or username", "ada");
    fill("Password", "wrong-password");
    submit();

    // Verbatim: the backend's sentence is the contract.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid email or password.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("does not report an unreachable API as bad credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/me") {
          return json({ error: { code: "UNAUTHENTICATED", message: "x" } }, 401);
        }
        // No HTTP response at all.
        throw new TypeError("fetch failed");
      }),
    );
    renderWithSession(<LoginForm />);

    fill("Email or username", "ada");
    fill("Password", "correct horse battery staple");
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/temporarily unavailable/i);
    expect(alert.textContent).not.toMatch(/password/i);
  });

  test("signs the user in and navigates on success", async () => {
    stubRoutes({
      "/api/auth/login": () => json({ user: USER }),
    });
    renderWithSession(<LoginForm />);

    fill("Email or username", "  ada  ");
    fill("Password", "correct horse battery staple");
    submit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(refreshMock).toHaveBeenCalled();
  });

  test("disables the button while the request is in flight", async () => {
    let settle!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/me") {
          return json({ error: { code: "UNAUTHENTICATED", message: "x" } }, 401);
        }
        return new Promise<Response>((resolve) => (settle = resolve));
      }),
    );
    renderWithSession(<LoginForm />);

    fill("Email or username", "ada");
    fill("Password", "correct horse battery staple");
    submit();

    const button = screen.getByRole("button");
    // This is what stops a double submission, so it is worth asserting rather
    // than assuming.
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(button.getAttribute("aria-busy")).toBe("true");

    settle(json({ user: USER }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });
});

describe("RegisterForm", () => {
  test("applies the shared validation rules before submitting", async () => {
    const fetchMock = stubRoutes({});
    renderWithSession(<RegisterForm />);

    fill("Email", "not-an-email");
    fill("Username", "ab");
    fill("Password", "short");
    submit();

    expect(await screen.findByText("Enter a valid email address.")).toBeDefined();
    expect(
      screen.getByText(
        "Username must be 3-30 characters, using only letters, digits and underscores.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Password must be at least 8 characters.")).toBeDefined();
    expect(
      fetchMock.mock.calls.filter(([url]) => url !== "/api/auth/me"),
    ).toHaveLength(0);
  });

  test("accepts an empty display name, which the backend defaults", async () => {
    const fetchMock = stubRoutes({
      "/api/auth/register": () => json({ user: USER }, 201),
    });
    renderWithSession(<RegisterForm />);

    fill("Email", "ada@example.com");
    fill("Username", "ada");
    fill("Password", "correct horse battery staple");
    submit();

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/"),
    );
    // Sent explicitly as an empty string rather than omitted: the Go decoder
    // rejects unknown fields and treats a missing one and an empty one alike.
    expect(bodySentTo(fetchMock, "/api/auth/register")).toEqual({
      email: "ada@example.com",
      username: "ada",
      display_name: "",
      password: "correct horse battery staple",
    });
  });

  test("shows the backend's message when the username is taken", async () => {
    stubRoutes({
      "/api/auth/register": () =>
        json(
          {
            error: {
              code: "USERNAME_ALREADY_EXISTS",
              message: "That username is already taken.",
            },
          },
          409,
        ),
    });
    renderWithSession(<RegisterForm />);

    fill("Email", "ada@example.com");
    fill("Username", "ada");
    fill("Password", "correct horse battery staple");
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That username is already taken.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  test("shows a backend validation error verbatim", async () => {
    stubRoutes({
      "/api/auth/register": () =>
        json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "password must be at most 128 characters",
            },
          },
          400,
        ),
    });
    renderWithSession(<RegisterForm />);

    fill("Email", "ada@example.com");
    fill("Username", "ada");
    fill("Password", "correct horse battery staple");
    submit();

    // The single string is rendered as-is. There is no attempt to guess which
    // field it refers to — that would need a backend contract change.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "password must be at most 128 characters",
    );
  });
});

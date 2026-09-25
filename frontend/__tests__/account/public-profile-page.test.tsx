import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PublicProfilePage, {
  generateMetadata,
} from "@/app/u/[username]/page";
import { ApiError } from "@/lib/api/errors";
import type { PublicProfile } from "@/lib/api/types";

/*
 * The public profile page.
 *
 * Two decisions here are worth pinning down. An unknown username becomes the
 * 404 page, while an unreachable API stays an error — "this person does not
 * exist" and "Opueh is down" are not the same sentence to a reader. And a
 * missing profile must not leak into the page title, because the API answers
 * identically for unknown, deleted, suspended and banned usernames on purpose;
 * a title that said which would undo that.
 *
 * The contract layer is mocked rather than stubbed at `fetch`. What is under
 * test is what this page does with a result, not how the request is built —
 * that is covered in `api/account-contracts.test.ts`.
 */

const { notFoundMock, fetchPublicProfileMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  fetchPublicProfileMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/lib/api/profile", () => ({
  fetchPublicProfile: fetchPublicProfileMock,
}));

const PROFILE: PublicProfile = {
  id: "22222222-2222-2222-2222-222222222222",
  username: "ada",
  display_name: "Ada Lovelace",
  bio: "Mathematician.",
  created_at: "2026-01-01T00:00:00Z",
};

/** The props Next passes, with `params` already a promise as this version has it. */
function propsFor(username: string) {
  return { params: Promise.resolve({ username }) } as never;
}

async function renderPage(username = "ada") {
  const element = await PublicProfilePage(propsFor(username));
  return render(element);
}

afterEach(() => {
  notFoundMock.mockClear();
  fetchPublicProfileMock.mockReset();
});

describe("PublicProfilePage", () => {
  it("renders the profile the API returned", async () => {
    fetchPublicProfileMock.mockResolvedValue({ ok: true, data: PROFILE });

    await renderPage();

    expect(screen.getByRole("heading").textContent).toBe("Ada Lovelace");
    expect(screen.getByText("@ada")).toBeDefined();
    expect(screen.getByText("Mathematician.")).toBeDefined();
  });

  it("asks for the username from the route", async () => {
    fetchPublicProfileMock.mockResolvedValue({ ok: true, data: PROFILE });

    await renderPage("someone-else");

    expect(fetchPublicProfileMock).toHaveBeenCalledWith("someone-else");
  });

  it("keeps a bio's line breaks", async () => {
    fetchPublicProfileMock.mockResolvedValue({
      ok: true,
      data: { ...PROFILE, bio: "Line one.\nLine two." },
    });

    await renderPage();

    // The backend keeps interior newlines when it trims, so they are content
    // the author put there. Without `whitespace-pre-line` the browser would
    // collapse them and lose it.
    const bio = screen.getByText(/Line one\./);
    expect(bio.textContent).toBe("Line one.\nLine two.");
    expect(bio.className).toContain("whitespace-pre-line");
  });

  it("says so when there is no bio, without rendering 'null'", async () => {
    fetchPublicProfileMock.mockResolvedValue({
      ok: true,
      data: { ...PROFILE, bio: null },
    });

    await renderPage();

    expect(
      screen.getByText("Ada Lovelace hasn't written a bio yet."),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain("null");
  });

  it("renders the 404 page for a username that does not exist", async () => {
    fetchPublicProfileMock.mockResolvedValue({
      ok: false,
      error: new ApiError("USER_NOT_FOUND", "user not found", 404),
    });

    await expect(renderPage("nobody")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("shows an error, not a 404, when the API is unreachable", async () => {
    fetchPublicProfileMock.mockResolvedValue({
      ok: false,
      error: ApiError.upstreamUnavailable(),
    });

    await renderPage();

    // A network failure says nothing about whether this person exists.
    // Rendering "not found" for one would tell a reader a real account is gone.
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Could not load this profile")).toBeDefined();
  });
});

describe("generateMetadata", () => {
  it("titles the page with the display name", async () => {
    fetchPublicProfileMock.mockResolvedValue({ ok: true, data: PROFILE });

    const metadata = await generateMetadata(propsFor("ada"));

    expect(metadata.title).toBe("Ada Lovelace");
    expect(metadata.description).toBe("Mathematician.");
  });

  it("says nothing distinguishing when the profile is missing", async () => {
    fetchPublicProfileMock.mockResolvedValue({
      ok: false,
      error: new ApiError("USER_NOT_FOUND", "user not found", 404),
    });

    const metadata = await generateMetadata(propsFor("nobody"));

    // The API answers identically for unknown, deleted, suspended and banned
    // usernames. A title that said which would undo that.
    expect(metadata.title).toBe("Profile");
    expect(metadata.description).toBeUndefined();
  });

  it("omits the description when there is no bio", async () => {
    fetchPublicProfileMock.mockResolvedValue({
      ok: true,
      data: { ...PROFILE, bio: null },
    });

    const metadata = await generateMetadata(propsFor("ada"));

    expect(metadata.description).toBeUndefined();
  });
});

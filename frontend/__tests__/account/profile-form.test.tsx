import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/account/profile-form";
import type { MyProfile } from "@/lib/api/types";
import { BIO_MAX_LENGTH } from "@/lib/validation";

/*
 * Editing display name and bio.
 *
 * The whole subtlety is that the patch contains ONLY the fields the user
 * changed. Upstream the fields are pointers, so an omitted `bio` leaves it
 * alone while `bio: ""` erases it — meaning a form that sent both fields every
 * time would wipe a bio whenever someone edited their display name, and the
 * loss would look like it came from nowhere.
 */

const PROFILE: MyProfile = {
  id: "22222222-2222-2222-2222-222222222222",
  username: "ada",
  display_name: "Ada",
  bio: "Mathematician.",
  email: "ada@example.com",
  role: "USER",
  email_verified: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubSave(response: Response | Error) {
  const mock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The parsed body of the PATCH that was sent, or undefined if none was. */
function patchSent(mock: ReturnType<typeof vi.fn>): unknown {
  const call = mock.mock.calls.find(
    ([, init]) => (init as RequestInit)?.method === "PATCH",
  );
  if (!call) return undefined;
  return JSON.parse((call[1] as RequestInit).body as string);
}

function fill(label: string, value: string) {
  // `exact: false` because a required field's label carries a decorative "*"
  // in a child span, so its text content is "Display name*".
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  });
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

function renderForm(onSaved = vi.fn(), profile = PROFILE) {
  render(<ProfileForm profile={profile} onSaved={onSaved} />);
  return onSaved;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileForm", () => {
  it("starts from the profile it was given", () => {
    renderForm();

    expect((screen.getByLabelText("Display name", { exact: false }) as HTMLInputElement).value).toBe("Ada");
    expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Mathematician.");
  });

  it("offers nothing to save until something changes", () => {
    renderForm();

    // Not only polish: a patch with no fields in it is a 400 upstream, so an
    // enabled button would be offering a request that cannot succeed.
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Nothing to save yet.")).toBeDefined();
  });

  it("enables saving once a field changes", () => {
    renderForm();

    fill("Display name", "Ada Lovelace");

    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not count surrounding whitespace as a change", () => {
    renderForm();

    fill("Display name", "  Ada  ");

    // The backend stores it trimmed, so it would return "Ada" anyway. Treating
    // this as a change would fire a request that saves nothing.
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends only the display name when only the display name changed", async () => {
    const mock = stubSave(jsonResponse({ ...PROFILE, display_name: "Ada Lovelace" }));
    renderForm();

    fill("Display name", "Ada Lovelace");
    save();

    await waitFor(() => expect(mock).toHaveBeenCalled());
    // No `bio` key at all. Sending `bio: "Mathematician."` would be harmless
    // today, but sending `bio: ""` is what a naive form does — and that erases
    // a bio the user never touched.
    expect(patchSent(mock)).toEqual({ display_name: "Ada Lovelace" });
  });

  it("trims the display name on the way out", async () => {
    const mock = stubSave(jsonResponse({ ...PROFILE, display_name: "Ada Lovelace" }));
    renderForm();

    fill("Display name", "  Ada Lovelace  ");
    save();

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(patchSent(mock)).toEqual({ display_name: "Ada Lovelace" });
  });

  it("sends only the bio when only the bio changed", async () => {
    const mock = stubSave(jsonResponse({ ...PROFILE, bio: "Programmer." }));
    renderForm();

    fill("Bio", "Programmer.");
    save();

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(patchSent(mock)).toEqual({ bio: "Programmer." });
  });

  it("sends a bio's interior newlines unchanged", async () => {
    const mock = stubSave(jsonResponse(PROFILE));
    renderForm();

    fill("Bio", "Line one.\nLine two.");
    save();

    await waitFor(() => expect(mock).toHaveBeenCalled());
    // A bio is prose, so its line breaks are content. Trimming the ends is the
    // backend's job; collapsing the middle here would lose it.
    expect(patchSent(mock)).toEqual({ bio: "Line one.\nLine two." });
  });

  it("sends a whitespace-only bio as typed, which the backend trims to a clear", async () => {
    const mock = stubSave(jsonResponse({ ...PROFILE, bio: null }));
    renderForm();

    fill("Bio", "   ");
    save();

    await waitFor(() => expect(mock).toHaveBeenCalled());
    // Sent as typed rather than pre-trimmed to "". The backend trims the ends,
    // so this arrives as a clear — and it is one, because clearing the field is
    // exactly what the user did.
    expect(patchSent(mock)).toEqual({ bio: "   " });
  });

  it("refuses an empty display name before making a request", async () => {
    const mock = stubSave(jsonResponse(PROFILE));
    renderForm();

    fill("Display name", "   ");
    save();

    // A PATCH of display_name is an instruction to SET it, and there is no
    // username fallback on that path — unlike registration, where empty means
    // "use the username".
    expect(await screen.findByText("Display name is required.")).toBeDefined();
    expect(mock).not.toHaveBeenCalled();
  });

  it("refuses a bio past the limit before making a request", async () => {
    const mock = stubSave(jsonResponse(PROFILE));
    renderForm();

    fill("Bio", "x".repeat(BIO_MAX_LENGTH + 1));
    save();

    expect(
      await screen.findByText(`Bio must be ${BIO_MAX_LENGTH} characters or fewer.`),
    ).toBeDefined();
    expect(mock).not.toHaveBeenCalled();
  });

  it("shows the backend's message verbatim when the save is refused", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "bio must be at most 500 characters",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    fill("Display name", "Ada Lovelace");
    save();

    // The backend is the authority. Rewording it here would create a second
    // copy of the message, free to drift from the one actually enforced.
    expect(
      await screen.findByText("bio must be at most 500 characters"),
    ).toBeDefined();
  });

  it("reports an unreachable API as unavailability, not as bad input", async () => {
    const fetchMock = stubSave(new TypeError("fetch failed"));
    renderForm();

    fill("Display name", "Ada Lovelace");
    save();

    expect(
      await screen.findByText(
        "Opueh is temporarily unavailable. Please try again in a moment.",
      ),
    ).toBeDefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("hands the saved profile back so the page can reflect it", async () => {
    const saved = { ...PROFILE, display_name: "Ada Lovelace" };
    stubSave(jsonResponse(saved));
    const onSaved = renderForm();

    fill("Display name", "Ada Lovelace");
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("re-enables saving after a failure so the user can try again", async () => {
    stubSave(new TypeError("fetch failed"));
    renderForm();

    fill("Display name", "Ada Lovelace");
    save();

    await screen.findByText(
      "Opueh is temporarily unavailable. Please try again in a moment.",
    );
    // Leaving the button spinning would strand the user with no way to retry
    // the edit they still have on screen.
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MobileNav } from "@/components/layout/mobile-nav";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
});

/** Renders the closed disclosure and returns its trigger. */
function renderClosed() {
  render(<MobileNav />);
  return screen.getByRole("button", { name: "Open navigation menu" });
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
  return screen.getByRole("button", { name: "Close navigation menu" });
}

describe("MobileNav", () => {
  test("starts closed, with no destinations reachable", () => {
    const trigger = renderClosed();

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Conditionally rendered rather than CSS-hidden, so a closed panel is
    // absent from the accessibility tree and the tab order.
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  test("opens when the trigger is activated", () => {
    renderClosed();
    const trigger = open();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Home" })).toBeDefined();
  });

  test("points the trigger at the panel it controls", () => {
    renderClosed();
    const trigger = open();

    const panelId = trigger.getAttribute("aria-controls") ?? "";
    expect(panelId).not.toBe("");
    expect(document.getElementById(panelId)).not.toBeNull();
  });

  test("closes when the trigger is activated again", () => {
    renderClosed();
    const trigger = open();

    fireEvent.click(trigger);

    expect(
      screen
        .getByRole("button", { name: "Open navigation menu" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  test("closes after a destination is followed", () => {
    renderClosed();
    open();

    fireEvent.click(screen.getByRole("link", { name: "Home" }));

    // Otherwise the panel would stay open on top of the page it navigated to.
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  test("closes on Escape", () => {
    renderClosed();
    open();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
  });

  test("stays open on unrelated keys", () => {
    renderClosed();
    open();

    fireEvent.keyDown(document, { key: "Enter" });

    expect(screen.getByRole("link", { name: "Home" })).toBeDefined();
  });
});

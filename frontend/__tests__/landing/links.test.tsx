import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import HomePage from "@/app/page";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { primaryNav } from "@/lib/navigation";

import { renderWithSession, signedOutFetch } from "../support/session";

// NavLinks reads the current route, which only exists inside the Next.js
// runtime. Pinning it to the landing route tests the shell as a visitor to the
// landing page actually sees it.
//
// `useRouter` is stubbed too: the header's session controls use it to navigate
// after a logout.
const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
  vi.stubGlobal("fetch", signedOutFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Renders the whole landing experience — shell and page together — which is
 * the only way these assertions mean anything. Checking the page's anchors
 * against the page's own sections would miss the header, and checking them
 * separately would miss a section being renamed out from under a link.
 *
 * Waits for the header's session controls to settle, so the routes they link
 * to are covered by the assertions below rather than being skipped while the
 * header still shows its loading placeholder.
 */
async function renderLanding() {
  const result = renderWithSession(
    <>
      <SiteHeader />
      <main>
        <HomePage />
      </main>
      <SiteFooter />
    </>,
  );

  await screen.findByRole("link", { name: "Sign up" });
  return result;
}

describe("landing page links", () => {
  test("every in-page anchor resolves to an element that exists", async () => {
    const { container } = await renderLanding();

    const anchors = [...container.querySelectorAll('a[href*="#"]')];
    expect(anchors.length).toBeGreaterThan(0);

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") ?? "";
      const id = href.slice(href.indexOf("#") + 1);

      expect(id, `"${href}" has no fragment`).not.toBe("");
      // The whole point: a renamed section id would leave every link to it
      // scrolling nowhere, which no other test would catch.
      expect(
        document.getElementById(id),
        `"${href}" points at #${id}, which is not on the page`,
      ).not.toBeNull();
    }
  });

  test("links to no internal route that has not been built", async () => {
    const { container } = await renderLanding();

    // Every route that exists. A new link to something not listed here would
    // render a 404, so it has to be added deliberately — which is how /login
    // and /register arrived when the account pages were built.
    const builtRoutes = new Set(["/", "/login", "/register"]);

    for (const anchor of container.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.includes("#")) {
        continue;
      }

      expect(
        builtRoutes.has(href),
        `"${href}" is linked but that route does not exist`,
      ).toBe(true);
    }
  });

  test("gives every navigation entry a link with a matching destination", async () => {
    const { container } = await renderLanding();

    for (const entry of primaryNav) {
      const link = [...container.querySelectorAll("a")].find(
        (anchor) =>
          anchor.getAttribute("href") === entry.href &&
          anchor.textContent?.trim() === entry.label,
      );

      expect(link, `no nav link for ${entry.href}`).toBeDefined();
    }
  });

  test("describes the call to action destinations in words, not 'click here'", async () => {
    const { container } = await renderLanding();

    for (const anchor of container.querySelectorAll('a[href*="#"]')) {
      const text = anchor.textContent?.trim() ?? "";

      expect(text.length).toBeGreaterThan(0);
      expect(text.toLowerCase()).not.toContain("click here");
    }
  });
});

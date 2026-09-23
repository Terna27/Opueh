import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import HomePage from "@/app/page";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { primaryNav } from "@/lib/navigation";

// NavLinks reads the current route, which only exists inside the Next.js
// runtime. Pinning it to the landing route tests the shell as a visitor to the
// landing page actually sees it.
const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
});

/**
 * Renders the whole landing experience — shell and page together — which is
 * the only way these assertions mean anything. Checking the page's anchors
 * against the page's own sections would miss the header, and checking them
 * separately would miss a section being renamed out from under a link.
 */
function renderLanding() {
  return render(
    <>
      <SiteHeader />
      <main>
        <HomePage />
      </main>
      <SiteFooter />
    </>,
  );
}

describe("landing page links", () => {
  test("every in-page anchor resolves to an element that exists", () => {
    const { container } = renderLanding();

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

  test("links to no internal route that has not been built", () => {
    const { container } = renderLanding();

    // "/" is the only route that exists. Anything else — /register, /login —
    // would render a 404, so it must be added here deliberately.
    const builtRoutes = new Set(["/"]);

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

  test("gives every navigation entry a link with a matching destination", () => {
    const { container } = renderLanding();

    for (const entry of primaryNav) {
      const link = [...container.querySelectorAll("a")].find(
        (anchor) =>
          anchor.getAttribute("href") === entry.href &&
          anchor.textContent?.trim() === entry.label,
      );

      expect(link, `no nav link for ${entry.href}`).toBeDefined();
    }
  });

  test("describes the call to action destinations in words, not 'click here'", () => {
    const { container } = renderLanding();

    for (const anchor of container.querySelectorAll('a[href*="#"]')) {
      const text = anchor.textContent?.trim() ?? "";

      expect(text.length).toBeGreaterThan(0);
      expect(text.toLowerCase()).not.toContain("click here");
    }
  });
});

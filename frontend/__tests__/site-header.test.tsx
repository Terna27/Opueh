import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SiteHeader } from "@/components/layout/site-header";
import { primaryNav } from "@/lib/navigation";
import { site } from "@/lib/site";

import { renderWithSession, signedOutFetch } from "./support/session";

// The active destination depends on the current route, which only exists
// inside the Next.js runtime. Stubbing the hook keeps these component tests
// deterministic and independent of the router.
//
// `useRouter` is stubbed too because the header now renders the session
// controls, which navigate after a logout.
const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
  // Signed out, so the header renders its links rather than a placeholder.
  vi.stubGlobal("fetch", signedOutFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SiteHeader", () => {
  test("renders the platform name as a link to the home route", () => {
    renderWithSession(<SiteHeader />);

    const wordmark = screen.getByRole("link", { name: site.name });
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  test("exposes a labelled primary navigation landmark", () => {
    renderWithSession(<SiteHeader />);

    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeDefined();
  });

  test("renders an entry for every configured destination", () => {
    renderWithSession(<SiteHeader />);

    for (const link of primaryNav) {
      const rendered = screen.getAllByRole("link", { name: link.label });
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered[0]?.getAttribute("href")).toBe(link.href);
    }
  });

  test("marks the current route with aria-current", () => {
    usePathnameMock.mockReturnValue("/");
    renderWithSession(<SiteHeader />);

    const links = screen.getAllByRole("link", { name: "Home" });
    const current = links.filter(
      (link) => link.getAttribute("aria-current") === "page",
    );
    expect(current.length).toBeGreaterThan(0);
  });

  test("does not mark the home route current from another route", () => {
    usePathnameMock.mockReturnValue("/somewhere-else");
    renderWithSession(<SiteHeader />);

    const links = screen.getAllByRole("link", { name: "Home" });
    for (const link of links) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });
});

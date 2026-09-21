import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { SiteHeader } from "@/components/layout/site-header";
import { primaryNav } from "@/lib/navigation";
import { site } from "@/lib/site";

// The active destination depends on the current route, which only exists
// inside the Next.js runtime. Stubbing the hook keeps these component tests
// deterministic and independent of the router.
const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
});

describe("SiteHeader", () => {
  test("renders the platform name as a link to the home route", () => {
    render(<SiteHeader />);

    const wordmark = screen.getByRole("link", { name: site.name });
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  test("exposes a labelled primary navigation landmark", () => {
    render(<SiteHeader />);

    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeDefined();
  });

  test("renders an entry for every configured destination", () => {
    render(<SiteHeader />);

    for (const link of primaryNav) {
      const rendered = screen.getAllByRole("link", { name: link.label });
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered[0]?.getAttribute("href")).toBe(link.href);
    }
  });

  test("marks the current route with aria-current", () => {
    usePathnameMock.mockReturnValue("/");
    render(<SiteHeader />);

    const links = screen.getAllByRole("link", { name: "Home" });
    const current = links.filter(
      (link) => link.getAttribute("aria-current") === "page",
    );
    expect(current.length).toBeGreaterThan(0);
  });

  test("does not mark the home route current from another route", () => {
    usePathnameMock.mockReturnValue("/somewhere-else");
    render(<SiteHeader />);

    const links = screen.getAllByRole("link", { name: "Home" });
    for (const link of links) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });
});

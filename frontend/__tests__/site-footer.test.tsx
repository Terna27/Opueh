import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { SiteFooter } from "@/components/layout/site-footer";
import { landingNav, sectionHref } from "@/lib/landing";
import { site } from "@/lib/site";

describe("SiteFooter", () => {
  test("names the platform", () => {
    render(<SiteFooter />);

    expect(screen.getByText(site.name)).toBeDefined();
    expect(screen.getByText(site.tagline)).toBeDefined();
  });

  test("exposes a labelled navigation landmark", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("navigation", { name: "Explore" })).toBeDefined();
  });

  test("links every landing section", () => {
    render(<SiteFooter />);

    for (const section of landingNav) {
      const link = screen.getByRole("link", { name: section.label });
      expect(link.getAttribute("href")).toBe(sectionHref(section.id));
    }
  });

  test("uses the same section list as the header navigation", () => {
    render(<SiteFooter />);

    // Both are built from `landingNav`, so a section cannot appear in one and
    // be missing from the other.
    expect(screen.getAllByRole("link")).toHaveLength(landingNav.length);
  });

  test("dates the copyright to the year the page is rendered", () => {
    render(<SiteFooter />);

    expect(
      screen.getByText(`© ${new Date().getFullYear()} ${site.name}`),
    ).toBeDefined();
  });
});

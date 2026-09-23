import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import HomePage, { metadata } from "@/app/page";
import {
  closingCta,
  community,
  featurePreview,
  hero,
  howItWorks,
  landingSections,
} from "@/lib/landing";
import { site, siteTitle } from "@/lib/site";

describe("HomePage", () => {
  test("has exactly one top-level heading", () => {
    render(<HomePage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
  });

  test("leads with the brand tagline as the headline", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: hero.headline }),
    ).toBeDefined();
    // The headline is the tagline, not a second copy of it that could drift.
    expect(hero.headline).toBe(site.tagline);
  });

  test("explains what Opueh is without claiming it is available", () => {
    render(<HomePage />);

    expect(screen.getByText(hero.description)).toBeDefined();
  });

  test("never puts a second h1 further down the page", () => {
    render(<HomePage />);

    // Every section below the hero must use h2, or the outline breaks.
    for (const title of [
      howItWorks.title,
      featurePreview.title,
      community.title,
      closingCta.title,
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeDefined();
    }
  });

  test.each([
    ["how it works", landingSections.howItWorks],
    ["the roadmap", landingSections.features],
    ["community", landingSections.community],
  ])("exposes %s as a section with an accessible name", (_label, section) => {
    const { container } = render(<HomePage />);

    const element = container.querySelector(`#${section.id}`);
    expect(element).not.toBeNull();

    // Named by the visible heading rather than an aria-label, so the region
    // name and what is on screen cannot disagree.
    const headingId = element?.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId ?? "")).not.toBeNull();
  });

  test("renders every step of the loop", () => {
    render(<HomePage />);

    for (const step of howItWorks.steps) {
      expect(
        screen.getByRole("heading", { level: 3, name: step.title }),
      ).toBeDefined();
    }
  });

  test("renders every planned capability", () => {
    render(<HomePage />);

    for (const feature of featurePreview.features) {
      expect(
        screen.getByRole("heading", { level: 3, name: feature.title }),
      ).toBeDefined();
    }
  });

  test("renders every community pillar", () => {
    render(<HomePage />);

    for (const pillar of community.pillars) {
      expect(
        screen.getByRole("heading", { level: 3, name: pillar.title }),
      ).toBeDefined();
    }
  });
});

describe("HomePage metadata", () => {
  test("uses the full brand title without the layout's template suffix", () => {
    // The root layout suffixes titles with "· Opueh"; `absolute` opts out, so
    // the home page is not branded twice.
    expect(metadata.title).toEqual({ absolute: siteTitle });
  });

  test("describes the platform", () => {
    expect(metadata.description).toBe(site.description);
  });
});

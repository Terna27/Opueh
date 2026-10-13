import { describe, expect, test } from "vitest";

import {
  anchorIdFor,
  currentSection,
  isActiveHref,
  primaryNav,
} from "@/lib/navigation";

describe("isActiveHref", () => {
  test("matches the root destination only on the root route", () => {
    expect(isActiveHref("/", "/")).toBe(true);
    expect(isActiveHref("/feed", "/")).toBe(false);
  });

  test("matches a destination on its own route", () => {
    expect(isActiveHref("/profile", "/profile")).toBe(true);
  });

  test("keeps a destination active on its subroutes", () => {
    expect(isActiveHref("/profile/settings", "/profile")).toBe(true);
    expect(isActiveHref("/profile/", "/profile")).toBe(true);
  });

  test("does not match a route that merely shares a prefix", () => {
    // "/profiles" is a different route to "/profile" and must not light it up.
    expect(isActiveHref("/profiles", "/profile")).toBe(false);
  });

  test("does not match unrelated routes", () => {
    expect(isActiveHref("/notifications", "/profile")).toBe(false);
  });

  test("never marks an in-page anchor as the current page", () => {
    // A fragment is a place within a route, not a route. A pathname never
    // carries one, so an anchor can never be the current destination —
    // "/" here, and the same link approached from its own fragment.
    expect(isActiveHref("/", "/#features")).toBe(false);
    expect(isActiveHref("/#features", "/#features")).toBe(false);
    expect(isActiveHref("/feed", "/#features")).toBe(false);
  });
});

describe("primaryNav", () => {
  test("gives every entry a label and a destination", () => {
    for (const entry of primaryNav) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.href.startsWith("/")).toBe(true);
    }
  });

  test("points only at the home route or an anchor within it", () => {
    // The landing page is the only route that exists. A nav entry pointing
    // anywhere else would render a link to a 404.
    for (const entry of primaryNav) {
      expect(entry.href).toMatch(/^\/$|^\/#[\w-]+$/);
    }
  });
});

describe("anchorIdFor", () => {
  test("resolves an anchor into the route being viewed", () => {
    expect(anchorIdFor("/", "/#features")).toBe("features");
    expect(anchorIdFor("/profile", "/profile#activity")).toBe("activity");
  });

  test("ignores an anchor into a different route", () => {
    // On the 404, "/#features" says nothing about where the reader is.
    expect(anchorIdFor("/somewhere-else", "/#features")).toBeNull();
    expect(anchorIdFor("/profile", "/#features")).toBeNull();
  });

  test("ignores a plain route link", () => {
    expect(anchorIdFor("/", "/")).toBeNull();
    expect(anchorIdFor("/profile", "/profile")).toBeNull();
  });

  test("ignores a bare fragment with nothing after it", () => {
    expect(anchorIdFor("/", "/#")).toBeNull();
  });
});

describe("currentSection", () => {
  const order = ["how-it-works", "features", "community"];

  test("returns the section in view", () => {
    expect(currentSection(order, new Set(["features"]))).toBe("features");
  });

  test("returns null when nothing is in view", () => {
    expect(currentSection(order, new Set())).toBeNull();
  });

  test("prefers the higher section when two overlap", () => {
    // Both can sit in the observing band mid-scroll. The one that started
    // higher is the one being read; the lower has only just appeared.
    expect(
      currentSection(order, new Set(["community", "how-it-works"])),
    ).toBe("how-it-works");
  });

  test("ignores ids it does not know about", () => {
    expect(currentSection(order, new Set(["something-else"]))).toBeNull();
  });
});

import { describe, expect, test } from "vitest";

import { isActiveHref } from "@/lib/navigation";

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
});

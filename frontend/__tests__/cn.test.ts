import { describe, expect, test } from "vitest";

import { cn } from "@/lib/cn";

describe("cn", () => {
  test("joins class names with a single space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  test("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
  });

  test("drops falsy entries", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  test("keeps a lone class", () => {
    expect(cn("a")).toBe("a");
  });

  test("keeps falsy-only input empty", () => {
    expect(cn(false, null, undefined)).toBe("");
  });

  test("does not deduplicate, because duplicates are harmless", () => {
    expect(cn("a", "a")).toBe("a a");
  });

  test("does not resolve conflicting utilities", () => {
    // Documented behaviour, not an accident: Tailwind resolves two conflicting
    // utilities by their order in the generated stylesheet, not by their order
    // in the class attribute, so `cn` cannot make the second win. Components
    // expose variants for genuinely different styling instead.
    expect(cn("px-4", "px-0")).toBe("px-4 px-0");
  });

  test("preserves the order it was given", () => {
    expect(cn("mt-2", "flex", "items-center")).toBe("mt-2 flex items-center");
  });
});

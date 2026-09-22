import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  test("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton />);

    // "placeholder, placeholder, placeholder" helps nobody. The region being
    // loaded should announce the wait instead.
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("takes its shape from a className", () => {
    const { container } = render(<Skeleton className="h-4 w-1/2" />);

    expect(container.firstElementChild?.className).toContain("h-4");
    expect(container.firstElementChild?.className).toContain("w-1/2");
  });

  test("has a default shape that still renders", () => {
    const { container } = render(<Skeleton />);

    expect(container.firstElementChild?.className).toContain("animate-pulse");
  });
});

describe("SkeletonText", () => {
  test("renders three lines by default", () => {
    const { container } = render(<SkeletonText />);

    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(3);
  });

  test("renders the requested number of lines", () => {
    const { container } = render(<SkeletonText lines={5} />);

    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(5);
  });

  test("shortens the last line so the block reads as a paragraph", () => {
    const { container } = render(<SkeletonText lines={3} />);

    const lines = container.querySelectorAll("[aria-hidden='true']");
    expect(lines[0]?.className).toContain("w-full");
    expect(lines[2]?.className).toContain("w-2/3");
  });

  test("handles a single line", () => {
    const { container } = render(<SkeletonText lines={1} />);

    const lines = container.querySelectorAll("[aria-hidden='true']");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.className).toContain("w-2/3");
  });

  test("is entirely hidden from assistive technology", () => {
    render(<SkeletonText />);

    expect(screen.queryByRole("status")).toBeNull();
  });
});

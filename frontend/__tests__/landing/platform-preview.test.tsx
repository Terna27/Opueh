import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { PlatformPreview } from "@/components/landing/platform-preview";

/** The subtree that carries `aria-hidden`. */
function hiddenSubtree(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!region) {
    throw new Error("the preview is not hidden from assistive technology");
  }
  return region;
}

describe("PlatformPreview", () => {
  test("is hidden from assistive technology", () => {
    const { container } = render(<PlatformPreview />);

    // Read aloud it is invented names and timestamps, which would interrupt
    // the page's real copy without adding anything to it.
    expect(hiddenSubtree(container)).toBeDefined();
  });

  test("describes itself for assistive technology instead", () => {
    render(<PlatformPreview />);

    const caption = screen.getByRole("figure").querySelector("figcaption");
    expect(caption?.textContent?.trim().length).toBeGreaterThan(0);
  });

  test("contains nothing focusable", () => {
    const { container } = render(<PlatformPreview />);

    // This is what makes hiding it legal. A focusable control inside an
    // aria-hidden subtree is unreachable by keyboard and invisible to a
    // screen reader at the same time — so the "Like / Comment / Share"
    // affordances must stay plain spans.
    const focusable = hiddenSubtree(container).querySelectorAll(
      "a, button, input, select, textarea, [tabindex]",
    );

    expect(focusable).toHaveLength(0);
  });

  test("claims no engagement numbers", () => {
    const { container } = render(<PlatformPreview />);

    // Counts are the one thing a reader would take as a claim about the
    // platform rather than as illustration.
    const text = hiddenSubtree(container).textContent ?? "";
    expect(text).not.toMatch(/\d+\s*(likes?|views?|followers?|replies|comments)/i);
  });

  test("depends on no external assets", () => {
    const { container } = render(<PlatformPreview />);

    // Avatars fall back to initials, so the preview renders identically with
    // no network and cannot show a broken image.
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  test("shows the post, its thread and a loading placeholder", () => {
    const { container } = render(<PlatformPreview />);

    expect(container.textContent).toContain("Rooftop timelapse, one take");
    expect(container.textContent).toContain("That third evening is the one.");
    // The skeleton standing in for the next post.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

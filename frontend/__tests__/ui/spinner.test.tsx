import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Spinner } from "@/components/ui/spinner";

describe("Spinner", () => {
  test("is decorative when it has no label", () => {
    const { container } = render(<Spinner />);

    // Hidden rather than announced: something nearby already says what is
    // happening, and two announcements of one state is noise.
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("becomes a live region when labelled", () => {
    render(<Spinner label="Loading posts" />);

    // The label is the live region's *content*, which is what gets announced.
    // `role="status"` is not named from its contents, so it has no accessible
    // name — asserting on one would be asserting the wrong thing.
    expect(screen.getByRole("status").textContent).toBe("Loading posts");
  });

  test("hides the visible label text from sight but not from a screen reader", () => {
    render(<Spinner label="Loading posts" />);

    expect(screen.getByText("Loading posts").className).toContain("sr-only");
  });

  test.each([
    ["sm", "size-3.5"],
    ["md", "size-4"],
    ["lg", "size-6"],
  ] as const)("renders the %s size", (size, expected) => {
    const { container } = render(<Spinner size={size} />);

    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      expected,
    );
  });

  test("defaults to medium", () => {
    const { container } = render(<Spinner />);

    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "size-4",
    );
  });

  test("accepts a className for colour and placement", () => {
    const { container } = render(<Spinner className="text-muted" />);

    expect(container.querySelector("svg")?.getAttribute("class")).toContain(
      "text-muted",
    );
  });

  test("can be rendered standalone", () => {
    const { container } = render(<Spinner size="lg" />);

    expect(container.querySelector("svg")).not.toBeNull();
  });
});

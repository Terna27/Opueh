import { fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, test, vi } from "vitest";

import { ErrorState } from "@/components/ui/error-state";

describe("ErrorState", () => {
  test("announces itself when it replaces content", () => {
    render(<ErrorState title="Something went wrong" />);

    expect(screen.getByRole("alert")).toBeDefined();
  });

  test("renders its title and description", () => {
    render(
      <ErrorState
        title="Could not load posts"
        description="Check your connection and try again."
      />,
    );

    expect(screen.getByText("Could not load posts")).toBeDefined();
    expect(
      screen.getByText("Check your connection and try again."),
    ).toBeDefined();
  });

  test("omits the description when there is none", () => {
    const { container } = render(<ErrorState title="Something went wrong" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  test("renders a retry action when given a handler", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Something went wrong" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("allows the retry label to be changed", () => {
    render(
      <ErrorState
        title="Something went wrong"
        onRetry={vi.fn()}
        retryLabel="Reload the page"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Reload the page" }),
    ).toBeDefined();
  });

  test("offers no retry when retrying cannot help", () => {
    render(<ErrorState title="This post was removed" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders an alternative action", () => {
    render(
      <ErrorState
        title="This post was removed"
        action={<Link href="/">Back to home</Link>}
      />,
    );

    expect(screen.getByRole("link", { name: "Back to home" })).toBeDefined();
  });

  test("renders a retry alongside an alternative action", () => {
    render(
      <ErrorState
        title="Something went wrong"
        onRetry={vi.fn()}
        action={<Link href="/">Back to home</Link>}
      />,
    );

    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeDefined();
  });

  test("does not render the action row when there is nothing to do", () => {
    const { container } = render(<ErrorState title="Something went wrong" />);

    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  test("shows only what it is given, never an error object", () => {
    // The prop is a string, so a raw Error cannot be threaded through by
    // accident — the type is the safeguard against leaking internals.
    render(
      <ErrorState
        title="Could not load posts"
        description="Something went wrong on our side."
      />,
    );

    expect(screen.queryByText(/at \w+ \(/)).toBeNull();
    expect(screen.queryByText(/stack/i)).toBeNull();
  });

  test("accepts a className that adds to its own styling", () => {
    const { container } = render(
      <ErrorState title="Something went wrong" className="py-24" />,
    );

    expect(container.firstElementChild?.className).toContain("py-24");
    expect(container.firstElementChild?.className).toContain("items-center");
  });
});

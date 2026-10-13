import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  test("renders its title", () => {
    render(<EmptyState title="No posts yet" />);

    expect(screen.getByText("No posts yet")).toBeDefined();
  });

  test("renders a description when given one", () => {
    render(
      <EmptyState
        title="No posts yet"
        description="Posts you create will appear here."
      />,
    );

    expect(screen.getByText("Posts you create will appear here.")).toBeDefined();
  });

  test("omits the description when there is none", () => {
    const { container } = render(<EmptyState title="No posts yet" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  test("renders an action when given one", () => {
    render(
      <EmptyState
        title="No posts yet"
        action={<button type="button">Create a post</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Create a post" }),
    ).toBeDefined();
  });

  test("renders nothing actionable when there is no action", () => {
    render(<EmptyState title="No notifications" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("renders an icon decoratively", () => {
    render(
      <EmptyState
        title="No search results"
        icon={<svg data-testid="icon" aria-hidden="true" />}
      />,
    );

    // The icon repeats what the title already says, so it is not announced.
    expect(screen.queryByTestId("icon")?.parentElement?.getAttribute(
      "aria-hidden",
    )).toBe("true");
  });

  test("omits the icon when there is none", () => {
    const { container } = render(<EmptyState title="No comments" />);

    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  test("is not a live region", () => {
    render(<EmptyState title="No posts yet" />);

    // Nothing failed and nothing is loading, so there is nothing to interrupt
    // the user for.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("accepts a className that adds to its own styling", () => {
    const { container } = render(
      <EmptyState title="No posts yet" className="py-24" />,
    );

    expect(container.firstElementChild?.className).toContain("py-24");
    expect(container.firstElementChild?.className).toContain("items-center");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import ErrorBoundary from "@/app/error";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The boundary logs the underlying error on purpose; silence it so the test
  // output stays readable.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("ErrorBoundary", () => {
  test("renders a top-level heading and a recovery action", () => {
    render(<ErrorBoundary error={new Error("boom")} reset={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  test("never renders the underlying error message", () => {
    render(
      <ErrorBoundary
        error={new Error("pq: password authentication failed for user")}
        reset={vi.fn()}
      />,
    );

    // Leaking driver or database detail into the UI is exactly what this
    // boundary exists to prevent.
    expect(screen.queryByText(/password authentication failed/i)).toBeNull();
  });

  test("calls reset when the recovery action is activated", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("logs the underlying error for debugging", () => {
    const error = new Error("boom");
    render(<ErrorBoundary error={error} reset={vi.fn()} />);

    expect(consoleError).toHaveBeenCalledWith(error);
  });
});

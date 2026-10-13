import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import NotFound from "@/app/not-found";

describe("NotFound", () => {
  test("renders a top-level heading explaining the dead end", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { level: 1, name: /does not exist/i }),
    ).toBeDefined();
  });

  test("offers a way back to the home route", () => {
    render(<NotFound />);

    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe(
      "/",
    );
  });
});

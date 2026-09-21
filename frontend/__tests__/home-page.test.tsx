import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import HomePage from "@/app/page";
import { site } from "@/lib/site";

describe("HomePage", () => {
  test("renders the platform name as the single top-level heading", () => {
    render(<HomePage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(site.name);
  });

  test("describes the platform", () => {
    render(<HomePage />);

    expect(screen.getByText(site.description)).toBeDefined();
  });
});

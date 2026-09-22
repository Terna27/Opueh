import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardTitle,
} from "@/components/ui/card";

describe("Card", () => {
  test("renders its children", () => {
    render(
      <Card>
        <p>Body</p>
      </Card>,
    );

    expect(screen.getByText("Body")).toBeDefined();
  });

  test("composes a header, content and footer", () => {
    render(
      <Card>
        <CardContent>
          <p>Body</p>
        </CardContent>
        <CardFooter>
          <p>Footer</p>
        </CardFooter>
      </Card>,
    );

    expect(screen.getByText("Body")).toBeDefined();
    expect(screen.getByText("Footer")).toBeDefined();
  });

  test("CardTitle is a heading so cards appear in the document outline", () => {
    render(
      <Card>
        <CardTitle>Recent activity</CardTitle>
      </Card>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Recent activity" }),
    ).toBeDefined();
  });

  test("CardDescription renders supporting text", () => {
    render(
      <Card>
        <CardDescription>Updated a moment ago</CardDescription>
      </Card>,
    );

    expect(screen.getByText("Updated a moment ago")).toBeDefined();
  });

  test("accepts a className that adds to its own styling", () => {
    const { container } = render(<Card className="mt-4" />);

    const card = container.firstElementChild;
    expect(card?.className).toContain("mt-4");
    expect(card?.className).toContain("rounded-lg");
  });

  test("passes through native attributes", () => {
    render(<Card data-testid="card" aria-busy="true" />);

    expect(screen.getByTestId("card").getAttribute("aria-busy")).toBe("true");
  });
});

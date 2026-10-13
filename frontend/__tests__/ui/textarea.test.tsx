import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  test("associates its label with the control", () => {
    render(<Textarea label="Bio" />);

    expect(screen.getByLabelText("Bio")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Bio" })).toBeDefined();
  });

  test("accepts typed text", () => {
    render(<Textarea label="Bio" />);

    const textarea = screen.getByLabelText("Bio");
    fireEvent.change(textarea, { target: { value: "Hello there" } });

    expect(textarea).toHaveProperty("value", "Hello there");
  });

  test("defaults to four rows", () => {
    render(<Textarea label="Bio" />);

    expect(screen.getByLabelText("Bio").getAttribute("rows")).toBe("4");
  });

  test("accepts a row count", () => {
    render(<Textarea label="Bio" rows={8} />);

    expect(screen.getByLabelText("Bio").getAttribute("rows")).toBe("8");
  });

  test("renders a placeholder", () => {
    render(<Textarea label="Bio" placeholder="Tell us about yourself" />);

    expect(
      screen.getByPlaceholderText("Tell us about yourself"),
    ).toBe(screen.getByLabelText("Bio"));
  });

  test("describes the control with its helper text", () => {
    render(<Textarea label="Bio" helperText="Up to 500 characters." />);

    const describedBy = screen
      .getByLabelText("Bio")
      .getAttribute("aria-describedby");

    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Up to 500 characters.",
    );
  });

  test("marks the control invalid and describes it with the error", () => {
    render(<Textarea label="Bio" error="Bio is too long." />);

    const textarea = screen.getByLabelText("Bio");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");

    const describedBy = textarea.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Bio is too long.",
    );
  });

  test("replaces the helper text with the error", () => {
    render(
      <Textarea
        label="Bio"
        helperText="Up to 500 characters."
        error="Bio is too long."
      />,
    );

    expect(screen.queryByText("Up to 500 characters.")).toBeNull();
    expect(screen.getByText("Bio is too long.")).toBeDefined();
  });

  test("can be disabled", () => {
    render(<Textarea label="Bio" disabled />);

    expect(screen.getByLabelText("Bio")).toHaveProperty("disabled", true);
  });

  test("can be required", () => {
    render(<Textarea label="Bio" required />);

    expect(screen.getByRole("textbox", { name: "Bio" })).toHaveProperty(
      "required",
      true,
    );
  });

  test("is resizable only vertically", () => {
    render(<Textarea label="Bio" />);

    // Horizontal resize lets the control be dragged past its container.
    expect(screen.getByLabelText("Bio").className).toContain("resize-y");
  });
});

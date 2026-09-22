import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Input } from "@/components/ui/input";

describe("Input", () => {
  test("associates its label with the control", () => {
    render(<Input label="Username" />);

    // getByLabelText only resolves via a real label/for or aria-labelledby
    // relationship, so this fails if the wiring is wrong.
    expect(screen.getByLabelText("Username")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Username" })).toBeDefined();
  });

  test("accepts typed text", () => {
    render(<Input label="Username" />);

    const input = screen.getByLabelText("Username");
    fireEvent.change(input, { target: { value: "jane_doe" } });

    expect(input).toHaveProperty("value", "jane_doe");
  });

  test("renders a placeholder", () => {
    render(<Input label="Username" placeholder="jane_doe" />);

    expect(
      screen.getByPlaceholderText("jane_doe"),
    ).toBe(screen.getByLabelText("Username"));
  });

  test("passes the native input type through", () => {
    render(<Input label="Email" type="email" />);

    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
  });

  describe("helper text", () => {
    test("is rendered and referenced by the control", () => {
      render(<Input label="Username" helperText="Letters and digits only." />);

      const input = screen.getByLabelText("Username");
      const describedBy = input.getAttribute("aria-describedby");

      expect(describedBy).not.toBeNull();
      const helper = document.getElementById(describedBy ?? "");
      expect(helper?.textContent).toBe("Letters and digits only.");
    });

    test("leaves the control undescribed when there is none", () => {
      render(<Input label="Username" />);

      expect(
        screen.getByLabelText("Username").getAttribute("aria-describedby"),
      ).toBeNull();
    });
  });

  describe("validation error", () => {
    test("marks the control invalid", () => {
      render(<Input label="Username" error="Username is required." />);

      expect(
        screen.getByLabelText("Username").getAttribute("aria-invalid"),
      ).toBe("true");
    });

    test("points the control at the error message", () => {
      render(<Input label="Username" error="Username is required." />);

      const describedBy = screen
        .getByLabelText("Username")
        .getAttribute("aria-describedby");
      const error = document.getElementById(describedBy ?? "");

      expect(error?.textContent).toBe("Username is required.");
    });

    test("replaces the helper text so the two cannot contradict", () => {
      render(
        <Input
          label="Username"
          helperText="Letters and digits only."
          error="Username is required."
        />,
      );

      expect(screen.getByText("Username is required.")).toBeDefined();
      expect(screen.queryByText("Letters and digits only.")).toBeNull();
    });

    test("is not marked invalid when there is no error", () => {
      render(<Input label="Username" />);

      expect(
        screen.getByLabelText("Username").getAttribute("aria-invalid"),
      ).toBeNull();
    });

    test("references only one element", () => {
      render(
        <Input
          label="Username"
          helperText="Letters and digits only."
          error="Username is required."
        />,
      );

      // A dangling id in aria-describedby is worse than none at all:
      // assistive technology announces nothing.
      const describedBy = screen
        .getByLabelText("Username")
        .getAttribute("aria-describedby");

      expect(describedBy?.split(/\s+/)).toHaveLength(1);
      expect(document.getElementById(describedBy ?? "")).not.toBeNull();
    });
  });

  test("can be disabled", () => {
    render(<Input label="Username" disabled />);

    expect(screen.getByLabelText("Username")).toHaveProperty("disabled", true);
  });

  test("can be required", () => {
    render(<Input label="Username" required />);

    expect(screen.getByRole("textbox", { name: "Username" })).toHaveProperty(
      "required",
      true,
    );
  });

  test("accepts an explicit id for the control", () => {
    render(<Input label="Username" id="signup-username" />);

    expect(screen.getByLabelText("Username").getAttribute("id")).toBe(
      "signup-username",
    );
  });

  test("gives each instance a distinct id", () => {
    render(
      <>
        <Input label="Username" />
        <Input label="Email" />
      </>,
    );

    expect(screen.getByLabelText("Username").getAttribute("id")).not.toBe(
      screen.getByLabelText("Email").getAttribute("id"),
    );
  });
});

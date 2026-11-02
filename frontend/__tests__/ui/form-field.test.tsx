import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FormField } from "@/components/ui/form-field";

describe("FormField", () => {
  test("wires a label to the control it renders", () => {
    render(
      <FormField label="Username">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    expect(screen.getByLabelText("Username")).toBeDefined();
  });

  test("describes the control with its helper text", () => {
    render(
      <FormField label="Username" helperText="Letters and digits only.">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    const describedBy = screen
      .getByLabelText("Username")
      .getAttribute("aria-describedby");

    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Letters and digits only.",
    );
  });

  test("marks the control invalid and describes it with the error", () => {
    render(
      <FormField label="Username" error="Username is required.">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    const input = screen.getByLabelText("Username");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Username is required.",
    );
  });

  test("the error takes precedence over helper text", () => {
    render(
      <FormField
        label="Username"
        helperText="Letters and digits only."
        error="Username is required."
      >
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    expect(screen.queryByText("Letters and digits only.")).toBeNull();
    expect(screen.getByText("Username is required.")).toBeDefined();
  });

  test("an empty-string error is still an error", () => {
    render(
      <FormField label="Username" error="">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    // `error !== undefined` rather than a truthiness check: a caller that sets
    // an empty message still means "this field failed".
    expect(
      screen.getByLabelText("Username").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  test("describes nothing when there is neither helper text nor error", () => {
    render(
      <FormField label="Username">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    expect(
      screen.getByLabelText("Username").getAttribute("aria-describedby"),
    ).toBeNull();
  });

  test("marks the control required and flags it on the label", () => {
    render(
      <FormField label="Username" required>
        {(wiring) => <input {...wiring} required />}
      </FormField>,
    );

    expect(screen.getByRole("textbox", { name: "Username" })).toHaveProperty(
      "required",
      true,
    );
    expect(screen.getByText("*").getAttribute("aria-hidden")).toBe("true");
  });

  test("the required marker does not become part of the accessible name", () => {
    render(
      <FormField label="Username" required>
        {(wiring) => <input {...wiring} required />}
      </FormField>,
    );

    // The label's text content is "Username*", but the marker is hidden from
    // assistive technology and the control's own `required` attribute carries
    // the state — so the name stays clean and the state is not announced twice.
    expect(screen.getByRole("textbox", { name: "Username" })).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Username*" })).toBeNull();
  });

  test("does not flag the label when the field is optional", () => {
    render(
      <FormField label="Username">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    expect(screen.queryByText("*")).toBeNull();
  });

  test("accepts an explicit control id", () => {
    render(
      <FormField label="Username" controlId="signup-username">
        {(wiring) => <input {...wiring} />}
      </FormField>,
    );

    expect(screen.getByLabelText("Username").getAttribute("id")).toBe(
      "signup-username",
    );
  });

  test("derives distinct ids per instance", () => {
    render(
      <>
        <FormField label="Username">
          {(wiring) => <input {...wiring} />}
        </FormField>
        <FormField label="Email">
          {(wiring) => <input {...wiring} />}
        </FormField>
      </>,
    );

    expect(screen.getByLabelText("Username").getAttribute("id")).not.toBe(
      screen.getByLabelText("Email").getAttribute("id"),
    );
  });

  test("supports a control that is not an input", () => {
    render(
      <FormField label="Visibility">
        {(wiring) => (
          <select {...wiring}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        )}
      </FormField>,
    );

    expect(screen.getByRole("combobox", { name: "Visibility" })).toBeDefined();
  });
});

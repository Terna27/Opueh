import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Button, buttonVariants } from "@/components/ui/button";

describe("Button", () => {
  test("renders its label", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  test("defaults to type=button so it cannot submit a form by accident", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  test("still allows an explicit submit button", () => {
    render(<Button type="submit">Save</Button>);

    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  test("calls onClick when activated", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("does not call onClick while disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).not.toHaveBeenCalled();
  });

  describe("loading", () => {
    test("disables the button, which is what prevents a repeated submission", () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );

      const button = screen.getByRole("button");
      expect(button).toHaveProperty("disabled", true);

      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    test("announces the busy state to assistive technology", () => {
      render(<Button loading>Save</Button>);

      expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
    });

    test("keeps its accessible name while loading", () => {
      render(<Button loading>Save</Button>);

      // The label stays in place rather than being replaced by a spinner, so
      // the control does not appear to change identity mid-request.
      expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    });

    test("shows a spinner that is hidden from assistive technology", () => {
      const { container } = render(<Button loading>Save</Button>);

      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      // No live region: the button's own label and aria-busy carry the meaning.
      expect(screen.queryByRole("status")).toBeNull();
    });

    test("is idle when not loading", () => {
      render(<Button>Save</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveProperty("disabled", false);
      expect(button.getAttribute("aria-busy")).toBeNull();
      expect(button.querySelector("svg")).toBeNull();
    });
  });

  test("passes through native attributes", () => {
    render(
      <Button name="save" data-testid="save">
        Save
      </Button>,
    );

    expect(screen.getByTestId("save").getAttribute("name")).toBe("save");
  });

  describe("variants and sizes", () => {
    test("each variant renders differently", () => {
      const variants = [
        "primary",
        "secondary",
        "outline",
        "ghost",
        "destructive",
      ] as const;

      const rendered = variants.map((variant) =>
        buttonVariants({ variant }),
      );

      expect(new Set(rendered).size).toBe(variants.length);
    });

    test("each size renders differently", () => {
      const sizes = ["sm", "md", "lg", "icon"] as const;

      const rendered = sizes.map((size) => buttonVariants({ size }));

      expect(new Set(rendered).size).toBe(sizes.length);
    });

    test("defaults to a medium primary button", () => {
      expect(buttonVariants()).toBe(buttonVariants({ variant: "primary", size: "md" }));
    });

    test("applies the variant and size it is given", () => {
      render(
        <Button variant="destructive" size="lg">
          Delete
        </Button>,
      );

      const className = screen.getByRole("button").className;
      expect(className).toContain("bg-destructive-solid");
      expect(className).toContain("h-12");
    });
  });

  describe("buttonVariants", () => {
    test("produces a class string usable on an element that is not a button", () => {
      const className = buttonVariants();

      expect(typeof className).toBe("string");
      expect(className).toContain("inline-flex");
      // The disabled styling is inert on a link, but harmless — and keeping it
      // means one definition of what a button looks like.
      expect(className).toContain("rounded-md");
    });

    test("includes shared chrome regardless of variant and size", () => {
      for (const variant of ["primary", "ghost"] as const) {
        expect(buttonVariants({ variant })).toContain("items-center");
      }
    });
  });
});

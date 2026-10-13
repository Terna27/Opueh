import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { Avatar, initialsFrom } from "@/components/ui/avatar";

describe("initialsFrom", () => {
  test.each([
    ["Jane Doe", "JD"],
    ["jane", "J"],
    ["jane_doe", "JD"],
    ["jane.doe", "JD"],
    ["jane-doe", "JD"],
    ["jane  doe", "JD"],
    ["  jane doe  ", "JD"],
    ["jane mary doe", "JD"],
    ["", "?"],
    ["   ", "?"],
    ["_", "?"],
  ])("turns %o into %o", (input, expected) => {
    expect(initialsFrom(input)).toBe(expected);
  });

  test("uppercases lowercase input and keeps already-uppercase input", () => {
    expect(initialsFrom("jane")).toBe("J");
    expect(initialsFrom("JANE")).toBe("J");
  });

  test("takes the first and last word, not the first two", () => {
    expect(initialsFrom("mary jane watson")).toBe("MW");
  });
});

describe("Avatar", () => {
  test("shows initials when there is no image", () => {
    render(<Avatar name="Jane Doe" />);

    expect(screen.getByText("JD")).toBeDefined();
  });

  test("renders the image when a source is given", () => {
    render(<Avatar src="/jane.png" name="Jane Doe" alt="Jane Doe" />);

    expect(screen.getByRole("img", { name: "Jane Doe" })).toBeDefined();
    expect(screen.queryByText("JD")).toBeNull();
  });

  test("falls back to initials when the image fails to load", () => {
    render(<Avatar src="/broken.png" name="Jane Doe" alt="Jane Doe" />);

    fireEvent.error(screen.getByRole("img", { name: "Jane Doe" }));

    expect(screen.getByText("JD")).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });

  describe("an image that failed before React was listening", () => {
    /*
     * The server renders the <img> and the browser starts fetching it while
     * parsing the tag, so a 404 can beat hydration to the error event. React
     * never sees it and the broken-image icon stays on screen forever — which
     * is exactly what happened in Chrome until the mount check was added.
     *
     * jsdom never finishes loading an image, so `complete` is false for one
     * with a src and the fallback cannot be triggered by accident. These tests
     * put the element into the state a browser leaves behind after a failure:
     * loading finished, no intrinsic size.
     */
    const originalDescriptors = {
      complete: Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        "complete",
      ),
      naturalWidth: Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        "naturalWidth",
      ),
    };

    function defineImageState(complete: boolean, naturalWidth: number) {
      Object.defineProperty(HTMLImageElement.prototype, "complete", {
        configurable: true,
        get: () => complete,
      });
      Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
        configurable: true,
        get: () => naturalWidth,
      });
    }

    afterEach(() => {
      // Put jsdom's own accessors back so later tests are unaffected.
      for (const [name, descriptor] of Object.entries(originalDescriptors)) {
        if (descriptor) {
          Object.defineProperty(HTMLImageElement.prototype, name, descriptor);
        } else {
          delete (HTMLImageElement.prototype as unknown as Record<string, unknown>)[
            name
          ];
        }
      }
    });

    test("falls back to initials without an error event ever arriving", () => {
      defineImageState(true, 0);

      render(<Avatar src="/already-broken.png" name="Jane Doe" alt="Jane Doe" />);

      expect(screen.getByText("JD")).toBeDefined();
      expect(screen.queryByRole("img")).toBeNull();
    });

    test("still shows an image that loaded successfully", () => {
      defineImageState(true, 200);

      render(<Avatar src="/jane.png" name="Jane Doe" alt="Jane Doe" />);

      expect(screen.getByRole("img", { name: "Jane Doe" })).toBeDefined();
    });

    test("keeps waiting on an image that is still loading", () => {
      defineImageState(false, 0);

      render(<Avatar src="/slow.png" name="Jane Doe" alt="Jane Doe" />);

      // Nothing has failed yet, so the image stays until it does.
      expect(screen.getByRole("img", { name: "Jane Doe" })).toBeDefined();
    });
  });

  test("tries a new source after a failure without needing a reset", () => {
    const { rerender } = render(
      <Avatar src="/broken.png" name="Jane Doe" alt="Jane Doe" />,
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("JD")).toBeDefined();

    rerender(<Avatar src="/jane.png" name="Jane Doe" alt="Jane Doe" />);

    expect(screen.getByRole("img", { name: "Jane Doe" })).toBeDefined();
  });

  test("is hidden from assistive technology when no alt is given", () => {
    const { container } = render(<Avatar src="/jane.png" name="Jane Doe" />);

    // The usual case: a post header already names its author in adjacent text.
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("is exposed to assistive technology when alt is given", () => {
    const { container } = render(
      <Avatar src="/jane.png" name="Jane Doe" alt="Jane Doe" />,
    );

    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBeNull();
  });

  test("hides the initials from assistive technology", () => {
    // The wrapper owns the accessible state, so the initials are decorative
    // even when the avatar itself is not.
    const { container } = render(
      <Avatar name="Jane Doe" alt="Jane Doe" />,
    );

    const initials = container.querySelector("span > span");
    expect(initials?.getAttribute("aria-hidden")).toBe("true");
  });

  describe("sizes", () => {
    test("defaults to medium", () => {
      const { container } = render(<Avatar name="Jane Doe" />);

      expect(container.firstElementChild?.className).toContain("size-8");
    });

    test.each([
      ["sm", "size-6"],
      ["md", "size-8"],
      ["lg", "size-10"],
      ["xl", "size-16"],
    ] as const)("renders the %s size", (size, expected) => {
      const { container } = render(<Avatar name="Jane Doe" size={size} />);

      expect(container.firstElementChild?.className).toContain(expected);
    });
  });

  test("accepts a className that adds to its own styling", () => {
    const { container } = render(<Avatar name="Jane Doe" className="shrink-0" />);

    expect(container.firstElementChild?.className).toContain("shrink-0");
    expect(container.firstElementChild?.className).toContain("rounded-full");
  });
});

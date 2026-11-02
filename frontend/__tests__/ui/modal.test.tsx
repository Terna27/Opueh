import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Modal } from "@/components/ui/modal";

/** The dialog element. Queried directly: a closed <dialog> is not rendered. */
function dialogElement(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector("dialog");
  if (!dialog) {
    throw new Error("Modal did not render a <dialog> element.");
  }
  return dialog;
}

describe("Modal", () => {
  test("is closed when open is false", () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()} title="Confirm">
        Body
      </Modal>,
    );

    expect(dialogElement(container).open).toBe(false);
  });

  test("opens when open is true", () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} title="Confirm">
        Body
      </Modal>,
    );

    expect(dialogElement(container).open).toBe(true);
  });

  test("opens and closes as the prop changes", () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <Modal open={false} onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );

    rerender(
      <Modal open onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );
    expect(dialogElement(container).open).toBe(true);

    rerender(
      <Modal open={false} onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );
    expect(dialogElement(container).open).toBe(false);
  });

  test("is labelled by its title and described by its description", () => {
    render(
      <Modal open onClose={vi.fn()} title="Delete post" description="This cannot be undone.">
        Body
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete post" });
    const describedBy = dialog.getAttribute("aria-describedby");

    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "This cannot be undone.",
    );
  });

  test("is described by nothing when there is no description", () => {
    render(
      <Modal open onClose={vi.fn()} title="Delete post">
        Body
      </Modal>,
    );

    expect(
      screen.getByRole("dialog").getAttribute("aria-describedby"),
    ).toBeNull();
  });

  test("renders its body and footer", () => {
    render(
      <Modal
        open
        onClose={vi.fn()}
        title="Delete post"
        footer={<button type="button">Confirm</button>}
      >
        <p>Are you sure?</p>
      </Modal>,
    );

    expect(screen.getByText("Are you sure?")).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDefined();
  });

  test("closes when the close button is used", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("dismissal", () => {
    test("reports a close that came from anywhere", () => {
      const onClose = vi.fn();
      const { container } = render(
        <Modal open onClose={onClose} title="Confirm">
          Body
        </Modal>,
      );

      // The element closes for Escape and for close() alike and fires this
      // event; it is the single path that reports back to the prop.
      dialogElement(container).dispatchEvent(new Event("close"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("allows Escape when dismissible", () => {
      const { container } = render(
        <Modal open onClose={vi.fn()} title="Confirm">
          Body
        </Modal>,
      );

      const cancel = new Event("cancel", { cancelable: true });
      dialogElement(container).dispatchEvent(cancel);

      expect(cancel.defaultPrevented).toBe(false);
    });

    test("blocks Escape when not dismissible", () => {
      const { container } = render(
        <Modal open onClose={vi.fn()} title="Confirm" dismissible={false}>
          Body
        </Modal>,
      );

      const cancel = new Event("cancel", { cancelable: true });
      dialogElement(container).dispatchEvent(cancel);

      // Nothing else offers a way out of a half-completed form by accident.
      expect(cancel.defaultPrevented).toBe(true);
    });

    test("closes on a click on the backdrop", () => {
      const onClose = vi.fn();
      const { container } = render(
        <Modal open onClose={onClose} title="Confirm">
          Body
        </Modal>,
      );

      fireEvent.click(dialogElement(container));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("stays open when the panel itself is clicked", () => {
      const onClose = vi.fn();
      render(
        <Modal open onClose={onClose} title="Confirm">
          Body
        </Modal>,
      );

      fireEvent.click(screen.getByText("Body"));

      expect(onClose).not.toHaveBeenCalled();
    });

    test("ignores a backdrop click when not dismissible", () => {
      const onClose = vi.fn();
      const { container } = render(
        <Modal open onClose={onClose} title="Confirm" dismissible={false}>
          Body
        </Modal>,
      );

      fireEvent.click(dialogElement(container));

      expect(onClose).not.toHaveBeenCalled();
    });

    test("stops listening once unmounted", () => {
      const onClose = vi.fn();
      const { container, unmount } = render(
        <Modal open onClose={onClose} title="Confirm">
          Body
        </Modal>,
      );

      const dialog = dialogElement(container);
      unmount();
      dialog.dispatchEvent(new Event("close"));

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

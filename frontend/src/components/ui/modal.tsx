"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Button } from "./button";

export type ModalProps = {
  /** Controlled open state. The dialog is driven by React, never by itself. */
  open: boolean;
  /** Called for every dismissal: the close button, Escape, or the backdrop. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions rendered in the dialog footer, e.g. Cancel and Confirm. */
  footer?: ReactNode;
  /**
   * Whether Escape and a backdrop click close the dialog. Set false when
   * dismissing would discard the user's work — a half-completed form, for
   * instance — and provide an explicit way out in `footer` instead.
   */
  dismissible?: boolean;
  className?: string;
};

/**
 * A modal dialog built on the native `<dialog>` element.
 *
 * Native rather than a library because the platform already provides the hard
 * parts: `showModal()` moves the dialog into the top layer, traps focus inside
 * it, makes the rest of the page inert, and handles Escape. A third-party
 * modal would reimplement all of that less reliably.
 *
 * What is left is the React-facing work: keeping the element's imperative
 * open state in step with the `open` prop, and reporting every dismissal path
 * back through a single `onClose`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // The prop is the source of truth. showModal()/close() are idempotent
  // guards here so this effect can run on any render without thrashing the
  // element's state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    // Fires when the element closes for any reason, Escape included. Passing
    // it upward is what keeps the prop and the element from disagreeing.
    function handleClose() {
      onClose();
    }

    // Escape dispatches "cancel" first; preventing it keeps the dialog open.
    //
    // This is load-bearing, and it only works for a real user. A browser only
    // makes `cancel` cancelable when the dialog was opened with user
    // activation; a dialog opened from a synthetic `element.click()` gets a
    // `cancel` event with `cancelable: false`, and preventDefault() on it is
    // silently ignored. Verified in Chrome 145 — so a test that clicks with
    // `.click()` will report `dismissible={false}` as broken when it is not.
    // Drive it with a trusted input event instead.
    function handleCancel(event: Event) {
      if (!dismissible) {
        event.preventDefault();
      }
    }

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onClose, dismissible]);

  /**
   * A click on the backdrop is delivered to the dialog element itself. The
   * panel below fills the dialog and carries the padding, so a click that
   * reaches the dialog is one that missed the panel.
   */
  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (dismissible && event.target === dialogRef.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={handleClick}
      // p-0 matters: it is what makes a click on the dialog element itself
      // identifiable as a backdrop click rather than a click on the panel.
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-background p-0 text-foreground shadow-lg",
        "backdrop:bg-black/50",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold leading-tight">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              className="size-4"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Button>
        </div>

        {children ? <div className="text-sm">{children}</div> : null}

        {footer ? (
          <div className="flex justify-end gap-2">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}

"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The aria attributes a control must carry to be correctly described by its
 * FormField. Spread these onto the control element.
 */
export type FieldWiring = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
};

export type FormFieldProps = {
  label: ReactNode;
  /** Guidance shown below the control while it is valid. */
  helperText?: ReactNode;
  /**
   * The current validation message. When set it replaces the helper text and
   * marks the control invalid, so the two can never contradict each other.
   */
  error?: string;
  required?: boolean;
  /** Render the control. Receives the attributes that wire it to this field. */
  children: (wiring: FieldWiring) => ReactNode;
  /** Overrides the generated control id, e.g. to match a server-rendered form. */
  controlId?: string;
  className?: string;
};

/**
 * Wires a label, a control and its messaging together accessibly.
 *
 * `Input` and `Textarea` use this internally, so most callers never need it.
 * It is exported for controls they do not cover — a select, a radio group, a
 * future media picker — which would otherwise have to reimplement the id and
 * `aria-describedby` bookkeeping.
 *
 * A render prop rather than an id-generating helper the caller has to thread
 * through: it is the only shape where the ids cannot get out of sync with the
 * elements that actually rendered.
 */
export function FormField({
  label,
  helperText,
  error,
  required = false,
  children,
  controlId,
  className,
}: FormFieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  // Only ids that were actually rendered are referenced. Pointing
  // aria-describedby at an element that is not in the DOM is worse than
  // pointing at nothing: assistive technology announces nothing at all.
  const showError = error !== undefined;
  const describedBy = showError
    ? errorId
    : helperText
      ? helperId
      : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          // Decorative: the required state is conveyed by the control's own
          // `required` attribute, so repeating it here would double-announce.
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": showError ? true : undefined,
      })}

      {showError ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-sm text-muted">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

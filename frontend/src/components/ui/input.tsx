"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { FormField } from "./form-field";

/**
 * Shared control chrome. The `aria-invalid` variant is driven by a data
 * attribute rather than a duplicated class string, so the error appearance is
 * declared once and follows the semantics automatically.
 */
export const controlClasses = cn(
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground",
  "placeholder:text-muted/70",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-destructive aria-invalid:outline-destructive",
);

export type InputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "id" | "className" | "children"
> & {
  label: ReactNode;
  helperText?: ReactNode;
  error?: string;
  id?: string;
  className?: string;
};

/**
 * A single-line text input with its label and messaging.
 *
 * The label is required. A placeholder is not a label — it disappears as soon
 * as the user types, and it is not reliably announced — so the component does
 * not offer a way to omit one.
 */
export function Input({
  label,
  helperText,
  error,
  id,
  className,
  required,
  ...props
}: InputProps) {
  return (
    <FormField
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      controlId={id}
    >
      {(wiring) => (
        // FormField's wiring is spread last: it owns the id and the
        // description attributes, which is the whole point of the component.
        <input
          {...props}
          {...wiring}
          required={required}
          className={cn(controlClasses, className)}
        />
      )}
    </FormField>
  );
}

"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

import { FormField } from "./form-field";
import { controlClasses } from "./input";

export type TextareaProps = Omit<
  ComponentPropsWithoutRef<"textarea">,
  "id" | "className" | "children"
> & {
  label: ReactNode;
  helperText?: ReactNode;
  error?: string;
  id?: string;
  className?: string;
};

/**
 * A multi-line text input with its label and messaging.
 *
 * Shares `controlClasses` with Input so the two cannot drift apart visually.
 * Resizing is limited to the vertical axis: horizontal resize lets a user drag
 * the control past its container and break the surrounding layout.
 */
export function Textarea({
  label,
  helperText,
  error,
  id,
  className,
  required,
  rows = 4,
  ...props
}: TextareaProps) {
  return (
    <FormField
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      controlId={id}
    >
      {(wiring) => (
        <textarea
          {...props}
          {...wiring}
          required={required}
          rows={rows}
          className={cn(controlClasses, "resize-y", className)}
        />
      )}
    </FormField>
  );
}

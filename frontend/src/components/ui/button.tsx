import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

import { Spinner } from "./spinner";

const variantClasses = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-foreground/10 text-foreground hover:bg-foreground/15",
  outline: "border border-border bg-background text-foreground hover:bg-foreground/5",
  ghost: "text-muted hover:bg-foreground/5 hover:text-foreground",
  destructive:
    "bg-destructive-solid text-destructive-foreground hover:opacity-90",
} as const;

const sizeClasses = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
  /** Square, for a button whose only content is an icon. */
  icon: "size-9",
} as const;

export type ButtonVariant = keyof typeof variantClasses;
export type ButtonSize = keyof typeof sizeClasses;

/** The classes a button-shaped element needs, for styling a non-button. */
export function buttonVariants({
  variant = "primary",
  size = "md",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
  );
}

export type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner and disables the button.
   *
   * This is what stops a double submission: the button is disabled for as long
   * as the action is in flight, so a second click cannot fire it again. The
   * label stays in place, so the button keeps its accessible name and does not
   * appear to change identity while the user is waiting on it.
   */
  loading?: boolean;
  className?: string;
};

/**
 * A button.
 *
 * `type` defaults to "button" rather than the HTML default of "submit". A
 * submit button is the rarer case and is now always an explicit choice, which
 * removes a whole class of accidental form submissions — pressing Enter in a
 * field, or clicking a stray control, can no longer submit a form by default.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      // Announces the busy state to assistive technology, which a spinner
      // alone cannot do.
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
}

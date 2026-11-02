import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Button } from "./button";

export type ErrorStateProps = {
  title: string;
  /**
   * A message safe to show a user.
   *
   * Never pass a raw `Error.message` here. The backend strips internal detail
   * from its responses and logs the real cause server-side; doing the same on
   * the client means a stack trace, a SQL fragment or an upstream URL cannot
   * end up on screen.
   */
  description?: string;
  /** Callback for the retry action. Omit it when retrying cannot help. */
  onRetry?: () => void;
  /** Overrides the retry button label, e.g. "Try again" or "Reload". */
  retryLabel?: string;
  /** An alternative to retrying, e.g. a link back to a safe page. */
  action?: ReactNode;
  className?: string;
};

/**
 * Shown when something failed.
 *
 * `role="alert"` so the message is announced when it replaces content, rather
 * than waiting for the user to navigate into it.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Try again",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <p className="text-base font-medium text-foreground">{title}</p>

      {description ? (
        <p className="max-w-sm text-sm text-muted">{description}</p>
      ) : null}

      {onRetry || action ? (
        <div className="mt-2 flex items-center gap-2">
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}

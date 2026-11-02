import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  title: string;
  description?: string;
  /** An action the user can take, e.g. a Button or a Button-styled Link. */
  action?: ReactNode;
  /** Optional illustration or icon, rendered above the title. */
  icon?: ReactNode;
  className?: string;
};

/**
 * Shown when a request succeeded but there is nothing to display.
 *
 * Distinct from ErrorState on purpose: "you have no notifications yet" and
 * "we could not load your notifications" call for different words, different
 * tone and different actions, and collapsing them into one component with a
 * flag would blur that.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="mb-1 text-muted">
          {icon}
        </div>
      ) : null}

      <p className="text-base font-medium text-foreground">{title}</p>

      {description ? (
        <p className="max-w-sm text-sm text-muted">{description}</p>
      ) : null}

      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

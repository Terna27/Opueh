import { cn } from "@/lib/cn";

export type SkeletonProps = {
  /**
   * Shape of the placeholder — height, width, rounding. A skeleton has no
   * intrinsic size because what it stands in for varies: a line of text, an
   * avatar, a thumbnail.
   */
  className?: string;
};

/**
 * A pulsing placeholder for content that has not loaded yet.
 *
 * `aria-hidden` on purpose: a screen reader gains nothing from "loading
 * placeholder, placeholder, placeholder". The region being loaded should
 * carry `aria-busy="true"` and an accessible status instead — see `Spinner`
 * with a label, or the `role="status"` on the route loading UI.
 *
 * Under `prefers-reduced-motion` the global rule in globals.css collapses the
 * pulse to nothing, leaving a static block, which is the intended fallback.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-foreground/10", className)}
    />
  );
}

export type SkeletonTextProps = {
  /** Number of lines to render. */
  lines?: number;
  className?: string;
};

/**
 * `lines` stacked text placeholders, the last one short so the block reads as
 * a paragraph rather than a solid rectangle.
 */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-4", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

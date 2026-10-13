import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

/**
 * The horizontal content measure, shared by every full-width region of the
 * app: the header, the footer, and each landing section.
 *
 * Declared once rather than repeated as a Tailwind class on each region. A
 * region that picked its own maximum width would not line up with the ones
 * above and below it — the header's wordmark would sit at a different left
 * edge from the hero that follows it, which reads as a mistake at every
 * breakpoint.
 *
 * The padding steps up with the viewport so the text never touches the edge of
 * a narrow screen, and the gutters grow on large ones so the measure does not
 * become uncomfortable to read.
 */
export function Container({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}
    />
  );
}

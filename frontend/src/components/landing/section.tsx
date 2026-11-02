import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";
import { cn } from "@/lib/cn";

export type SectionProps = {
  /** The anchor target. Must match the id other elements link to. */
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  /** `surface` tints the band, which is how alternating sections separate. */
  tone?: "default" | "surface";
  children: ReactNode;
  className?: string;
};

/**
 * A landing-page band: a heading block and its content, on the shared measure.
 *
 * Every section on the page is built from this so they share one rhythm of
 * vertical space and one heading size. A section that hand-rolled its own
 * heading would drift out of step with the others the first time the spacing
 * changed.
 *
 * `aria-labelledby` points at the visible heading, which gives the section a
 * region role and a name. The heading is real text rather than an `aria-label`
 * so the name and what is on screen cannot disagree.
 *
 * No scroll offset is set here: `scroll-padding-top` in globals.css already
 * clears the sticky header, and stacking a `scroll-mt-*` on top of it would
 * double the gap.
 */
export function Section({
  id,
  eyebrow,
  title,
  description,
  tone = "default",
  children,
  className,
}: SectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "border-t border-border py-16 sm:py-20 lg:py-24",
        tone === "surface" && "bg-surface",
        className,
      )}
    >
      <Container>
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          {eyebrow ? (
            <p className="text-sm font-medium tracking-wide text-primary uppercase">
              {eyebrow}
            </p>
          ) : null}

          <h2
            id={headingId}
            className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            {title}
          </h2>

          {description ? (
            <p className="mt-4 text-base leading-7 text-muted">{description}</p>
          ) : null}
        </div>

        <div className="mt-12 sm:mt-16">{children}</div>
      </Container>
    </section>
  );
}

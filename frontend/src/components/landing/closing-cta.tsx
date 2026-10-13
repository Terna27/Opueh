import Link from "next/link";

import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { closingCta } from "@/lib/landing";

/**
 * The closing call to action.
 *
 * Built directly rather than through `Section`: that component renders a
 * heading block above its content, and this section *is* the panel — running
 * it through `Section` would put the heading outside the card it belongs to.
 *
 * `Card` is left on its own surface colour rather than being given a tint,
 * because `cn` cannot override the background a component already sets — see
 * the note in `lib/cn.ts`. The decorative glow behind the panel carries the
 * emphasis instead, the same way it does in the hero.
 */
export function ClosingCta() {
  return (
    <section
      aria-labelledby="closing-cta-heading"
      className="relative overflow-hidden border-t border-border py-16 sm:py-20 lg:py-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-[-8rem] h-72 bg-primary/5 blur-3xl"
      />

      <Container className="relative">
        <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2
            id="closing-cta-heading"
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            {closingCta.title}
          </h2>

          <p className="max-w-xl text-base leading-7 text-muted">
            {closingCta.description}
          </p>

          <div className="mt-4 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href={closingCta.primaryCta.href}
              className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
            >
              {closingCta.primaryCta.label}
            </Link>

            <Link
              href={closingCta.secondaryCta.href}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "w-full sm:w-auto",
              )}
            >
              {closingCta.secondaryCta.label}
            </Link>
          </div>
        </Card>
      </Container>
    </section>
  );
}

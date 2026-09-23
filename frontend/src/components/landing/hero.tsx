import Link from "next/link";

import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { hero, sectionHref } from "@/lib/landing";

import { PlatformPreview } from "./platform-preview";

/**
 * The landing page hero.
 *
 * The only `h1` on the page — every other section heading is an `h2`. It is
 * named by `aria-labelledby` pointing at that visible heading, so the region's
 * name is text the reader can see.
 *
 * `overflow-hidden` is load-bearing rather than cosmetic: the decorative glow
 * below is wider than the viewport, and without it the page would scroll
 * sideways. It is `aria-hidden` and `pointer-events-none` because it carries
 * no meaning and must not swallow clicks aimed at the content above it.
 *
 * Both calls to action are in-page anchors. `/register` and `/login` do not
 * exist yet, and a hero button that 404s is worse than one that scrolls.
 * They are `Link`s wearing button styling, not `Button`s: they navigate, and a
 * button element that changes the URL is wrong for keyboard and screen-reader
 * users alike.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-32 h-80 bg-primary/5 blur-3xl"
      />

      <Container className="relative grid gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-28">
        <div className="flex flex-col items-start">
          <p className="text-sm font-medium tracking-wide text-primary uppercase">
            {hero.eyebrow}
          </p>

          <h1
            id="hero-heading"
            className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl"
          >
            {hero.headline}
          </h1>

          <p className="mt-6 max-w-prose text-base leading-7 text-muted sm:text-lg">
            {hero.description}
          </p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href={sectionHref(hero.primaryCta.id)}
              className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
            >
              {hero.primaryCta.label}
            </Link>

            <Link
              href={sectionHref(hero.secondaryCta.id)}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "w-full sm:w-auto",
              )}
            >
              {hero.secondaryCta.label}
            </Link>
          </div>
        </div>

        {/*
          Below `lg` the hero is one column, so the preview would otherwise
          stretch the full width of the page — and because it holds a 16:9
          video box, stretching it makes it taller rather than wider, leaving a
          huge grey rectangle dominating the tablet view. Capping the width
          keeps it a preview rather than the whole screen.
        */}
        <div className="mx-auto w-full max-w-lg min-w-0 lg:mx-0 lg:max-w-none">
          <PlatformPreview />
        </div>
      </Container>
    </section>
  );
}

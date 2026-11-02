import Link from "next/link";

import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { hero } from "@/lib/landing";

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
        className="brand-fill pointer-events-none absolute inset-x-0 -top-24 h-72 opacity-[0.07] blur-3xl"
      />

      <Container className="relative grid gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-28">
        <div className="flex flex-col items-start">
          <p className="brand-text text-sm font-semibold tracking-wide uppercase">
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
              href={hero.primaryCta.href}
              className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
            >
              {hero.primaryCta.label}
            </Link>

            <Link
              href={hero.secondaryCta.href}
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
          stretch the full width of the page — and stretching it is worse here
          than it sounds, because the preview's centrepiece derives its width
          from a fixed height (a 9:16 frame). Given more width it does not get
          wider, it gets taller, and a preview that tall pushes the copy off
          the first screen. Capping the width keeps it a preview rather than
          the whole page.
        */}
        <div className="mx-auto w-full max-w-lg min-w-0 lg:mx-0 lg:max-w-none">
          <PlatformPreview />
        </div>
      </Container>
    </section>
  );
}

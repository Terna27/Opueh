import Link from "next/link";

import { landingNav, sectionHref } from "@/lib/landing";
import { site } from "@/lib/site";

import { Container } from "./container";

/**
 * The application footer. A Server Component — no state, no route awareness.
 *
 * The "Explore" list is built from the same landing-section definitions the
 * header navigation uses, so a section can never appear in one and be missing
 * from the other.
 *
 * The copyright year is resolved when the page is rendered. Pages are
 * prerendered at build time, so this reflects the build date; the site is
 * rebuilt on deploy, which is the conventional trade-off and avoids shipping
 * a client component purely to read the clock.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border">
      <Container className="flex flex-col gap-8 py-12 sm:flex-row sm:justify-between">
        <div className="max-w-xs">
          <p className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              O
            </span>
            {site.name}
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">{site.tagline}</p>
        </div>

        <nav aria-label="Explore" className="text-sm">
          <h2 className="font-medium text-foreground">Explore</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {landingNav.map((section) => (
              <li key={section.id}>
                <Link
                  href={sectionHref(section.id)}
                  className="rounded-md text-muted transition-colors hover:text-foreground"
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      <Container className="flex flex-col gap-1 border-t border-border py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          &copy; {year} {site.name}
        </p>
        <p>Built in the open.</p>
      </Container>
    </footer>
  );
}

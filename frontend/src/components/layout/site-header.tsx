import Link from "next/link";

import { site } from "@/lib/site";

import { Container } from "./container";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";

/**
 * The application header.
 *
 * A Server Component: everything here is static markup. The two pieces that
 * need the current route or interaction state (NavLinks, MobileNav) are
 * Client Components, so the client bundle stays limited to what actually
 * needs it.
 *
 * `relative` anchors the mobile panel, which is positioned against this
 * header so it spans the full viewport width.
 */
export function SiteHeader() {
  return (
    <header className="relative sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-base font-semibold tracking-tight text-foreground"
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            O
          </span>
          {site.name}
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-2">
          <NavLinks className="hidden items-center gap-1 md:flex" />
          <MobileNav />
        </nav>
      </Container>
    </header>
  );
}

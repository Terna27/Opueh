import Link from "next/link";

import { site } from "@/lib/site";

import { Container } from "./container";
import { AuthNav } from "./auth-nav";
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
            className="brand-fill flex size-8 items-center justify-center rounded-xl text-sm font-bold text-brand-foreground"
          >
            O
          </span>
          {site.name}
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-2">
          <NavLinks className="hidden items-center gap-1 md:flex" />
          {/* Session controls, not navigation: rendered next to the links
              because that is where they belong visually, and they announce
              themselves as buttons and links rather than as page sections. */}
          <AuthNav />
          <MobileNav />
        </nav>
      </Container>
    </header>
  );
}

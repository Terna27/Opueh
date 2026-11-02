"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  anchorIdFor,
  currentSection,
  isActiveHref,
  primaryNav,
} from "@/lib/navigation";

/**
 * The height of the sticky header, in pixels, as the browser itself resolved
 * `scroll-padding-top` from globals.css.
 *
 * `rootMargin` accepts pixels or percentages only — a `rem` string is a
 * SyntaxError that takes the whole effect down with it — so the stylesheet's
 * own value cannot be reused verbatim. Reading what it resolved to keeps the
 * band aligned with the anchor offset without restating "5rem" in a second
 * place that a retune would leave behind.
 *
 * Falls back to 5rem at the default 16px root size if the property is not
 * resolvable, which is the case in jsdom.
 */
function headerOffsetPx(): number {
  const resolved = Number.parseFloat(
    getComputedStyle(document.documentElement).scrollPaddingTop,
  );
  return Number.isFinite(resolved) ? resolved : 80;
}

type NavLinksProps = {
  /**
   * Invoked after a destination is followed. The mobile menu uses this to
   * dismiss itself, so the panel never stays open over the page it navigated
   * to. Deliberately a callback rather than an effect watching the pathname:
   * no state is updated during render, and nothing has to run after paint.
   */
  onNavigate?: () => void;
  className?: string;
};

/**
 * The header's navigation list. A Client Component because both the active
 * destination and the section the reader has scrolled into are only knowable
 * in the browser.
 *
 * Exactly one entry is marked at a time — either the route the reader is on,
 * or the section of it they are inside. Marking both would leave two items
 * lit with no way to tell which one means "you are here", and the highlight is
 * the same colour either way, so it has to answer one question.
 */
export function NavLinks({ onNavigate, className }: NavLinksProps) {
  const pathname = usePathname();

  // The section the reader has scrolled into, tagged with the route it was
  // observed on. Tagging rather than clearing on navigation keeps the reset
  // out of the effect — a section seen on the landing page simply stops
  // applying once the pathname moves on, with no extra render, and state is
  // never written from the effect body.
  const [observed, setObserved] = useState<{
    route: string;
    section: string | null;
  } | null>(null);

  const activeSection = observed?.route === pathname ? observed.section : null;

  useEffect(() => {
    // Sections are found through the DOM, which only exists in a browser.
    // Without this guard a server render or a jsdom test would throw.
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const ids = primaryNav
      .map((link) => anchorIdFor(pathname, link.href))
      .filter((id): id is string => id !== null);

    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) {
      return;
    }

    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }
        setObserved({ route: pathname, section: currentSection(ids, visible) });
      },
      {
        // A band running from just under the sticky header to a fifth of the
        // way down the screen. A section counts as current once its heading
        // has reached the top of the reading area, not the moment it appears
        // at the bottom — otherwise the entry for a section would light up
        // while the reader is still nowhere near it.
        //
        // The top offset follows `scroll-padding-top` in globals.css.
        rootMargin: `-${headerOffsetPx()}px 0px -70% 0px`,
      },
    );

    for (const element of elements) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [pathname]);

  return (
    <ul className={className}>
      {primaryNav.map((link) => {
        const sectionId = anchorIdFor(pathname, link.href);

        // A section entry is active when the reader is inside that section; a
        // route entry only while they are not inside any section, so the two
        // can never both be lit.
        const active = sectionId
          ? sectionId === activeSection
          : isActiveHref(pathname, link.href) && activeSection === null;

        return (
          <li key={link.href}>
            <Link
              href={link.href}
              onClick={onNavigate}
              // Communicates what is marked to assistive technology; the
              // colour change alone is not an accessible signal. "page" is the
              // route, "location" is a place within the current one — the
              // distinction the two kinds of entry actually have.
              aria-current={
                active ? (sectionId ? "location" : "page") : undefined
              }
              className={[
                "block rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-foreground/5 font-medium text-foreground"
                  : "text-muted hover:bg-foreground/5 hover:text-foreground",
              ].join(" ")}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

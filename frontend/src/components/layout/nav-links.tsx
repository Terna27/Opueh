"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActiveHref, primaryNav } from "@/lib/navigation";

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
 * The primary navigation list. A Client Component because the active
 * destination depends on the current route, which is only known in the
 * browser.
 */
export function NavLinks({ onNavigate, className }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <ul className={className}>
      {primaryNav.map((link) => {
        const active = isActiveHref(pathname, link.href);

        return (
          <li key={link.href}>
            <Link
              href={link.href}
              onClick={onNavigate}
              // Communicates the current page to assistive technology; the
              // colour change alone is not an accessible signal.
              aria-current={active ? "page" : undefined}
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

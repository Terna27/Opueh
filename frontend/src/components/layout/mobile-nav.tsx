"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";

import { NavLinks } from "./nav-links";

/**
 * The small-screen navigation disclosure.
 *
 * A disclosure rather than a modal dialog: it is inline content that expands
 * under the header, so focus stays where the user put it and no focus trap is
 * needed. Escape closes it, and so does following a destination.
 *
 * The panel is conditionally rendered rather than hidden with CSS, so when it
 * is closed its links are absent from the accessibility tree and the tab
 * order — not merely invisible.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Escape closes the panel while it is open. Subscribing only while open
  // keeps the document listener off the page the rest of the time.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </Button>

      {open ? (
        <div
          id={panelId}
          className="absolute inset-x-0 top-full border-b border-border bg-background px-4 pt-2 pb-4 shadow-sm sm:px-6"
        >
          <NavLinks
            onNavigate={() => setOpen(false)}
            className="flex flex-col gap-1"
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className="size-5"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className="size-5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

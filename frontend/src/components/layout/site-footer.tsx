import { site } from "@/lib/site";

/**
 * The application footer. A Server Component — no state, no route awareness.
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          &copy; {year} {site.name}
        </p>
        <p>{site.tagline}</p>
      </div>
    </footer>
  );
}

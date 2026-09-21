import { site } from "@/lib/site";

/**
 * Home route.
 *
 * An intentionally plain placeholder: this milestone proves the shell —
 * routing, layout, header, footer and styling — runs end to end. The real
 * landing experience is Milestone 3, which replaces this file wholesale.
 */
export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center sm:px-6">
      <p className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium tracking-wide text-muted uppercase">
        Milestone 1 · Foundation
      </p>

      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        {site.name}
      </h1>

      <p className="max-w-xl text-base leading-7 text-muted sm:text-lg">
        {site.description}
      </p>

      <p className="max-w-xl text-sm leading-6 text-muted">
        The landing page arrives in Milestone 3. This route exists so the shell,
        navigation and styling can be verified end to end.
      </p>
    </div>
  );
}

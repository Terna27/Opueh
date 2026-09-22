import { Spinner } from "@/components/ui/spinner";

/**
 * Route-level loading UI.
 *
 * Next.js wraps the page in a Suspense boundary using this as the fallback.
 * For the statically prerendered routes the shell has today it will not be
 * seen; it becomes visible once a milestone adds a route that awaits data,
 * and it is what lets such a route be partially prefetched.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-3 px-4 py-24 sm:px-6">
      {/*
        The spinner is left unlabelled and decorative. The `role="status"` on
        the text below is the live region that announces the wait, so labelling
        both would announce it twice.
      */}
      <Spinner size="lg" />

      <p role="status" className="text-sm text-muted">
        Loading…
      </p>
    </div>
  );
}

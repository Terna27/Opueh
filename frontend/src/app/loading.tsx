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
    <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-24 sm:px-6">
      {/*
        role="status" is a live region, so assistive technology announces the
        wait instead of leaving the user with silence.
      */}
      <p role="status" className="text-sm text-muted">
        Loading…
      </p>
    </div>
  );
}

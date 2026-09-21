"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Must be a Client Component — React error boundaries only exist on the
 * client. In production Next.js strips the original message from `error` and
 * leaves a `digest` that correlates with the server log, so the UI stays
 * generic and the real cause is logged rather than shown. Never render
 * `error.message` here: it can carry internal detail.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Something went wrong
      </h1>

      <p className="max-w-md text-sm leading-6 text-muted">
        The page could not be displayed. Try again, and if the problem
        continues, come back later.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}

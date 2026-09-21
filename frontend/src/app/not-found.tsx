import Link from "next/link";

/**
 * Route-level 404. Rendered inside the root layout, so the header and footer
 * stay available and the user is never stuck on a dead end.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center sm:px-6">
      <p className="text-sm font-medium text-muted">404</p>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        This page does not exist
      </h1>

      <p className="max-w-md text-sm leading-6 text-muted">
        The link may be broken, or the page may have been moved.
      </p>

      <Link
        href="/"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Back to home
      </Link>
    </div>
  );
}

"use client";

/**
 * The form-level error, shown above the submit button.
 *
 * Separate from the per-field messages `FormField` renders: this is for
 * whatever the backend said when the whole submission was rejected — wrong
 * credentials, a username already taken, an unreachable API. Those have no
 * single field to attach to, and inventing one would point the user at the
 * wrong input.
 *
 * `role="alert"` so it is announced when it appears, rather than being missed
 * by someone who cannot see the form re-render.
 */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

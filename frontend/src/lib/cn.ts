/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not `clsx` + `tailwind-merge`. The important consequence of
 * that choice, which callers must know:
 *
 *   Tailwind resolves two conflicting utilities by their order in the
 *   generated stylesheet, NOT by their order in the class attribute. So
 *   `cn("px-4", "px-0")` does not reliably produce `px-0`.
 *
 * Components here therefore treat `className` as a way to ADD layout (margins,
 * grid placement, width) on top of the component's own styling — not as a way
 * to override it. Where a caller genuinely needs different styling, the
 * component exposes a variant or size for it. If overriding becomes a real
 * need, `tailwind-merge` is the right dependency to add; it is not needed yet.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

import { cn } from "@/lib/cn";

const sizeClasses = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-6",
} as const;

export type SpinnerSize = keyof typeof sizeClasses;

const strokeWidths: Record<SpinnerSize, number> = {
  sm: 3,
  md: 3,
  lg: 2.5,
};

type SpinnerProps = {
  size?: SpinnerSize;
  /**
   * Accessible label. Supply it when the spinner is the only indication that
   * something is loading, which makes the spinner a live region that assistive
   * technology announces.
   *
   * Leave it out when the spinner sits next to text that already says what is
   * happening — inside a Button, for example, where the button's own label and
   * `aria-busy` carry the meaning. Without a label the spinner is decorative
   * and hidden from assistive technology, so it is never announced twice.
   */
  label?: string;
  className?: string;
};

/**
 * An indeterminate loading indicator.
 *
 * The animation is a rotating ring. Under `prefers-reduced-motion` the global
 * rule in globals.css collapses the duration to near zero, which stops the
 * rotation; the ring stays visible, so the indicator degrades to a static mark
 * rather than disappearing.
 */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  const svg = (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("animate-spin", sizeClasses[size], className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={strokeWidths[size]}
        className="opacity-25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={strokeWidths[size]}
        strokeLinecap="round"
      />
    </svg>
  );

  if (!label) {
    // Decorative: the surrounding text already conveys the state.
    return svg;
  }

  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}

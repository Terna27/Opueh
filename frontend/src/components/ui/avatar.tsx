"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

const sizeClasses = {
  sm: "size-6 text-[0.625rem]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-16 text-lg",
} as const;

export type AvatarSize = keyof typeof sizeClasses;

/**
 * Derives up to two initials from a display name or username.
 *
 * Separators are split on as well as whitespace, so "jane_doe" and "jane.doe"
 * both yield "JD" rather than "J".
 */
export function initialsFrom(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);

  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";

  return (first + last).toUpperCase() || "?";
}

export type AvatarProps = {
  src?: string | null;
  /** Display name or username. Always required — it produces the initials. */
  name: string;
  /**
   * Alternative text.
   *
   * Omit it when the avatar is decorative, which is the usual case: a post
   * header already names its author in adjacent text, and announcing the face
   * as well would be noise. An omitted `alt` hides the whole avatar from
   * assistive technology.
   *
   * Supply it only when the avatar is the sole carrier of the information.
   */
  alt?: string;
  size?: AvatarSize;
  className?: string;
};

/**
 * A user avatar: an image where one loads, initials otherwise.
 *
 * Uses a plain `<img>` rather than `next/image`. Avatar sources are
 * user-supplied and served from object storage whose host is not known until
 * Milestone 11, so `next/image` would need a `remotePatterns` allowlist that
 * cannot be written accurately yet. Revisit when the media host is fixed.
 */
export function Avatar({
  src,
  name,
  alt,
  size = "md",
  className,
}: AvatarProps) {
  // Records WHICH source failed rather than a boolean, so a new src is tried
  // automatically without an effect to reset the flag when the prop changes.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  // Recover from a failure React never saw.
  //
  // The server renders the <img>, and the browser starts fetching it while it
  // parses the tag — long before hydration attaches onError. If that fetch
  // fails, the event is long gone by the time anything is listening, and a
  // broken-image icon sits there permanently instead of the initials. An image
  // that has finished loading with no intrinsic width is an image that failed.
  //
  // Verified in Chrome: without this, a 404 avatar stayed broken forever.
  useEffect(() => {
    const img = imgRef.current;
    if (src && img && img.complete && img.naturalWidth === 0) {
      setFailedSrc(src);
    }
  }, [src]);

  const decorative = alt === undefined;

  return (
    <span
      // One attribute on the wrapper is enough to hide the image and the
      // initials together.
      aria-hidden={decorative || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground/10 font-medium text-muted select-none",
        sizeClasses[size],
        className,
      )}
    >
      {showImage && src ? (
        // eslint-disable-next-line @next/next/no-img-element -- see the component doc comment
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ""}
          onError={() => setFailedSrc(src)}
          className="size-full object-cover"
        />
      ) : (
        // The initials stand in for the image visually; the accessible name,
        // where there is one, comes from the image's alt text.
        <span aria-hidden="true">{initialsFrom(name)}</span>
      )}
    </span>
  );
}

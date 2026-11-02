import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

/**
 * A surface for grouping related content: a post, a profile section, a
 * dashboard tile, a form.
 *
 * Kept as plain composition rather than a configurable component with `title`
 * and `footer` props. Cards in this app differ enough — a post card's header
 * is an avatar and a timestamp, a form card's is a heading — that props would
 * either be unused or would have to model every case.
 *
 * `rounded-2xl` and the 1px border are the app's surface language: a soft,
 * generous radius on a barely-lighter panel, which is how a media-first feed
 * separates items without drawing hard boxes around them.
 */
export function Card({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-2xl border border-border bg-surface text-foreground",
        className,
      )}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cn("flex flex-col gap-1 p-4", className)} />;
}

export function CardTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      {...props}
      className={cn("text-base font-semibold leading-tight", className)}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return <p {...props} className={cn("text-sm text-muted", className)} />;
}

export function CardContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cn("p-4 pt-0", className)} />;
}

export function CardFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn("flex items-center gap-2 p-4 pt-0", className)}
    />
  );
}

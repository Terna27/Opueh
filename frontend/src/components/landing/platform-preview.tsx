import type { ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

/**
 * An illustrative preview of the Opueh feed.
 *
 * This is a mock, not a component under test: it renders no data, calls no
 * API and holds no state. It exists so the landing page can show the shape of
 * the product without a screenshot that would go stale.
 *
 * The shape it shows is the three references the product is built from: a
 * story rail across the top, a vertical video carrying its own action rail,
 * and a threaded reply underneath. Vertical media with the actions beside it
 * is the part that makes it read as a video product rather than as a feed of
 * articles.
 *
 * Four deliberate constraints:
 *
 * 1. The whole thing is `aria-hidden`. Read aloud it is a pile of invented
 *    names and timestamps that would interrupt the page's actual copy, and it
 *    tells a screen-reader user nothing the surrounding section does not. The
 *    `figcaption` carries the description instead.
 *
 * 2. Nothing inside is focusable, which is what makes the rule above legal.
 *    A focusable control inside an `aria-hidden` subtree is unreachable by
 *    keyboard and invisible to assistive technology at the same time — so the
 *    action rail is a list of spans and SVGs, not `Button`s.
 *
 * 3. No engagement counts. Numbers are the one thing on this page a reader
 *    would take as a claim about the platform rather than as illustration.
 *
 * 4. The vertical video carries a fixed height with its aspect ratio deriving
 *    the width (`aspect-[9/16] h-64`), rather than a width with the height
 *    deriving. A 9:16 box sized by width is 78% taller than it is wide, which
 *    inside the hero's column means a card roughly 700px tall — a preview that
 *    pushes the actual copy off the first screen.
 *
 * `Card`, `Avatar` and `Skeleton` are used as they are; the card's own
 * `CardHeader`/`CardTitle` are not, because a mock post is not a titled card
 * and `cn` cannot override their layout — see the note in `lib/cn.ts`.
 */
export function PlatformPreview() {
  return (
    <figure className="min-w-0">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <StoryRail />
        <VideoCard />
        <ThreadCard />
        <LoadingCard />
      </div>

      <figcaption className="sr-only">
        An illustration of the planned Opueh feed: a rail of followed accounts,
        a vertical video post with its actions alongside, a comment thread
        beneath it, and a placeholder where the next post will load.
      </figcaption>
    </figure>
  );
}

const STORYTELLERS = ["Ada Mbeki", "Kwame Osei", "Nadia Rahman", "Tom Iversen"];

/**
 * The story rail. A gradient ring marks an unwatched story; the first entry is
 * the reader's own, which is why it carries the plus rather than a ring.
 */
function StoryRail() {
  return (
    <div className="flex items-start gap-3 overflow-hidden">
      <div className="flex w-14 shrink-0 flex-col items-center gap-1.5">
        <span className="relative flex size-10 items-center justify-center rounded-full border border-dashed border-border text-muted">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="size-4"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="w-full truncate text-center text-[0.625rem] text-muted">
          Your story
        </span>
      </div>

      {STORYTELLERS.map((name) => (
        <div
          key={name}
          className="flex w-14 shrink-0 flex-col items-center gap-1.5"
        >
          <span className="brand-fill rounded-full p-[2px]">
            {/* The gap between ring and face. Without it the gradient reads as
                a coloured avatar rather than as a ring around one. */}
            <span className="block rounded-full bg-background p-[2px]">
              <Avatar name={name} size="lg" />
            </span>
          </span>
          <span className="w-full truncate text-center text-[0.625rem] text-muted">
            {name.split(" ")[0]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A vertical video post.
 *
 * The play affordance, the progress bar and the duration sit ON the frame,
 * because that is where a video player puts them; the caption and the actions
 * sit beside it, because a vertical frame leaves no room to overlay them
 * without covering the picture.
 */
function VideoCard() {
  return (
    <Card className="overflow-hidden p-3">
      <div className="flex items-center gap-3">
        <span className="brand-fill rounded-full p-[2px]">
          <span className="block rounded-full bg-background p-[2px]">
            <Avatar name="Ada Mbeki" size="sm" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Ada Mbeki</p>
          <p className="truncate text-xs text-muted">@ada · 12m</p>
        </div>
        {/* Deliberately NOT the brand gradient. Filled with it, a passive
            state label became the loudest element in the card — louder than
            the page's real calls to action. The gradient is a signature for
            the mark and the story rings; a status chip stays quiet. */}
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">
          Following
        </span>
      </div>

      <div className="mt-3 flex items-stretch gap-3">
        <div className="relative aspect-[9/16] h-64 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-foreground/20 to-foreground/5">
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-background/90 text-foreground">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="size-5 translate-x-px fill-current"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>

          {/* Progress. The filled portion is the accent, so the only colour on
              the frame is the thing telling you where you are. */}
          <span className="absolute inset-x-2 bottom-2 block h-0.5 rounded-full bg-background/40">
            <span className="brand-fill block h-full w-1/3 rounded-full" />
          </span>

          <span className="absolute top-2 right-2 rounded-full bg-background/80 px-2 py-0.5 text-[0.625rem] font-medium text-foreground">
            8:24
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Rooftop timelapse, one take</p>
            <p className="text-xs leading-5 text-muted">
              Shot over three evenings from the same corner. Sound on.
            </p>
          </div>

          <ActionRail />
        </div>
      </div>
    </Card>
  );
}

/**
 * The action rail. Stacked icons with labels, matching how a vertical video
 * carries its actions beside the frame.
 *
 * A `<ul>` rather than a row of divs: it is a list of actions, and the list
 * semantics are free. Nothing here is interactive — see constraint 2 above.
 */
function ActionRail() {
  return (
    <ul className="flex items-center gap-4">
      <RailItem label="Like">
        <path d="M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z" />
      </RailItem>
      <RailItem label="Comment">
        <path d="M20 12a7 7 0 01-7 7H8l-4 3v-4.6A7 7 0 0113 5a7 7 0 017 7z" />
      </RailItem>
      <RailItem label="Share">
        <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 16V4M8 8l4-4 4 4" />
      </RailItem>
      <RailItem label="Save">
        <path d="M6 4h12v16l-6-4-6 4z" />
      </RailItem>
    </ul>
  );
}

function RailItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col items-center gap-1 text-muted">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        {children}
      </svg>
      <span className="text-[0.625rem]">{label}</span>
    </li>
  );
}

function ThreadCard() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name="Kwame Osei" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Kwame Osei · 4m</p>
          <p className="mt-1 text-sm">That third evening is the one.</p>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-3 border-l border-border pl-4">
        <Avatar name="Ada Mbeki" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Ada Mbeki · 2m</p>
          <p className="mt-1 text-sm">The light did all the work.</p>
        </div>
      </div>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
    </Card>
  );
}

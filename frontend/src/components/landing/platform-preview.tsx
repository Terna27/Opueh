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
 * Three deliberate constraints:
 *
 * 1. The whole thing is `aria-hidden`. Read aloud it is a pile of invented
 *    names and timestamps that would interrupt the page's actual copy, and it
 *    tells a screen-reader user nothing the surrounding section does not. The
 *    `figcaption` carries the description instead.
 *
 * 2. Nothing inside is focusable, which is what makes the rule above legal.
 *    A focusable control inside an `aria-hidden` subtree is unreachable by
 *    keyboard and invisible to assistive technology at the same time — so the
 *    "Like / Comment / Share" affordances are plain spans, not `Button`s.
 *
 * 3. No engagement counts. Numbers are the one thing on this page a reader
 *    would take as a claim about the platform rather than as illustration.
 *
 * `Card`, `Avatar` and `Skeleton` are used as they are; the card's own
 * `CardHeader`/`CardTitle` are not, because a mock post is not a titled card
 * and `cn` cannot override their layout — see the note in `lib/cn.ts`.
 */
export function PlatformPreview() {
  return (
    <figure className="min-w-0">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <FeedCard />
        <ThreadCard />
        <LoadingCard />
      </div>

      <figcaption className="sr-only">
        An illustration of the planned Opueh feed: a video post from a
        followed account, with a comment thread beneath it and a placeholder
        where the next post will load.
      </figcaption>
    </figure>
  );
}

function FeedCard() {
  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 p-4">
        <Avatar name="Ada Mbeki" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Ada Mbeki</p>
          <p className="truncate text-xs text-muted">@ada · 12m</p>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
          Following
        </span>
      </div>

      <div className="px-4">
        <div className="relative flex aspect-video items-center justify-center rounded-md bg-foreground/10">
          <span className="flex size-11 items-center justify-center rounded-full bg-background/90 text-foreground">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-5 translate-x-px fill-current"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="absolute right-2 bottom-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[0.625rem] font-medium text-background">
            8:24
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 p-4">
        <p className="text-sm font-medium">Rooftop timelapse, one take</p>
        <p className="text-xs leading-5 text-muted">
          Shot over three evenings from the same corner.
        </p>
        <div className="mt-2 flex items-center gap-4 text-xs text-muted">
          <span>Like</span>
          <span>Comment</span>
          <span>Share</span>
        </div>
      </div>
    </Card>
  );
}

function ThreadCard() {
  return (
    <Card className="p-4 lg:ml-10">
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
    <Card className="p-4 lg:ml-10">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <SkeletonText lines={2} className="flex-1" />
      </div>
    </Card>
  );
}

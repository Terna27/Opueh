"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/**
 * How far a layer travels, in pixels, when the cursor is at the very edge of
 * the viewport. Scaled per layer by `--depth` in globals.css, so the far layer
 * moves ~5px where the near one moves ~21px.
 */
const MAX_SHIFT = 34;

/**
 * The fraction of the remaining distance closed each frame. Low enough that
 * the field trails the cursor rather than snapping to it — the lag is what
 * makes it read as distance rather than as a thing being dragged.
 */
const EASE = 0.075;

/** Below this the layer has visually arrived, so the loop can stop. */
const SETTLED = 0.0015;

/** Back to front. The order is also the paint order, which is what `key` uses. */
const LAYERS = ["far", "mid", "near"] as const;

/**
 * The starfield: three tiled layers of coloured dots that drift slowly and
 * follow the cursor at different rates.
 *
 * WHY THIS IS A CLIENT COMPONENT
 *
 * Only the cursor parallax needs JavaScript; the dots, the drift and the
 * dark-mode gating are all CSS. A pointer position is simply not knowable
 * during a server render, so the parallax has to live on the client. The
 * markup it renders is static, so the server and client renders agree and
 * there is no hydration mismatch — the layers just sit at rest until the first
 * pointer move.
 *
 * THE COST MODEL, WHICH IS THE REASON FOR THE SHAPE OF THIS EFFECT
 *
 * A naive version runs a `requestAnimationFrame` loop forever, writing a
 * transform 60 times a second whether anything moved or not. This one starts a
 * frame only on a pointer move, and stops as soon as the layers have caught up
 * (`SETTLED`). A still cursor therefore costs nothing at all on the main
 * thread, while the ambient drift keeps running — that is a CSS animation, so
 * the compositor owns it and JavaScript is not involved.
 *
 * The distance is written to the container as `--px`/`--py` rather than to
 * each layer. One write drives all three, and the per-layer scaling stays in
 * the stylesheet where the rest of the visual tuning lives.
 *
 * WHAT IT REFUSES TO DO
 *
 * - `prefers-reduced-motion: reduce` — no listeners, no frames, and the
 *   variables are cleared so the field sits still. This is checked in JS, not
 *   only in CSS, because otherwise the loop would still run and do nothing.
 *   The preference is also watched, so turning it on mid-session stops a field
 *   that is already moving.
 * - Touch input — a finger is not a cursor, and a drag to scroll arrives as a
 *   `pointermove`, so the field would swim whenever the page scrolled. That
 *   reads as a bug, not as depth. Filtered on the event's own `pointerType`,
 *   not on a `(pointer: fine)` query; see the note in `handlePointerMove`.
 */
export function Starfield() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    // Aliased, not used directly: the guard above narrows `element` in this
    // scope, but the narrowing does not survive into the closures below, and
    // `node`'s inferred type has no `null` in it to narrow away.
    const node = element;

    // Optional calls: `matchMedia` is absent in some non-browser environments,
    // and a missing query should mean "not reduced" rather than a thrown
    // effect that takes the whole page down with it.
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    let frame = 0;
    let listening = false;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    function tick() {
      currentX += (targetX - currentX) * EASE;
      currentY += (targetY - currentY) * EASE;

      node.style.setProperty("--px", `${(currentX * MAX_SHIFT).toFixed(2)}px`);
      node.style.setProperty("--py", `${(currentY * MAX_SHIFT).toFixed(2)}px`);

      if (
        Math.abs(targetX - currentX) > SETTLED ||
        Math.abs(targetY - currentY) > SETTLED
      ) {
        frame = requestAnimationFrame(tick);
      } else {
        // Arrived. Stopping here rather than continuing to write the same
        // value is the difference between an idle page and one that spends a
        // frame's work per frame doing nothing.
        frame = 0;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      // A finger is not a cursor. On touch, a drag to scroll *is* a
      // `pointermove`, so without this the field would swim every time the
      // page scrolled — which reads as a bug, not as depth.
      //
      // Asked of the event rather than of `(pointer: fine)`, which was the
      // first attempt and was wrong. The media query describes the *primary*
      // device, and reports `none` wherever Chrome cannot see one — headless
      // reports fine=false, coarse=false, none=true — so the parallax
      // switched itself off on desktop hardware. The event carries the fact
      // directly: `pointerType` is "mouse", "pen" or "touch", and only the
      // last one should be ignored.
      if (event.pointerType === "touch") {
        return;
      }

      // -1 at the left/top edge, 0 at the centre, 1 at the right/bottom.
      targetX = (event.clientX / window.innerWidth - 0.5) * 2;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2;

      if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;

      if (listening) {
        window.removeEventListener("pointermove", handlePointerMove);
        listening = false;
      }

      // Back to rest, so a field stopped by a preference change does not stay
      // frozen wherever it happened to be.
      currentX = 0;
      currentY = 0;
      targetX = 0;
      targetY = 0;
      node.style.removeProperty("--px");
      node.style.removeProperty("--py");
    }

    function sync() {
      const wanted = !motion?.matches;

      if (!wanted) {
        stop();
        return;
      }

      if (!listening) {
        window.addEventListener("pointermove", handlePointerMove, {
          // The handler never calls preventDefault, and saying so lets the
          // browser skip a scroll-blocking check on every move.
          passive: true,
        });
        listening = true;
      }
    }

    sync();
    motion?.addEventListener?.("change", sync);

    return () => {
      motion?.removeEventListener?.("change", sync);
      stop();
    };
  }, []);

  return (
    <div
      ref={ref}
      // Decorative: it carries no meaning, so it is hidden from assistive
      // technology, and `pointer-events-none` keeps it from swallowing clicks
      // aimed at the content it sits behind.
      aria-hidden="true"
      className="starfield pointer-events-none fixed inset-0 -z-10"
    >
      {LAYERS.map((layer) => (
        <div
          key={layer}
          className={cn("starfield__layer", `starfield__layer--${layer}`)}
        >
          <div
            className={cn("starfield__drift", `starfield__drift--${layer}`)}
          />
        </div>
      ))}
    </div>
  );
}

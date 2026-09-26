import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Starfield } from "@/components/layout/starfield";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The one query the component is allowed to ask. Anything else throws.
 *
 * A permissive fake is worse than none. If this one answered an unrecognised
 * query with `false`, a typo in the component — `(prefers-reduced-motion:reduce)`
 * with the space missing, say — would silently mean "motion is fine", the
 * parallax would never engage, and every test here would still pass. That is
 * the same class of bug that let a bad `rootMargin` ship green in
 * nav-links.test.tsx, so the fake validates rather than shrugs.
 *
 * It also means this test fails if the component goes back to gating the
 * parallax on a `(pointer: fine)` query. That gate was a real bug: it is false
 * wherever Chrome cannot see a pointing device — headless reports
 * fine=false, coarse=false, none=true — so the field sat still on desktop
 * hardware while the unit tests, which stubbed the query to `true`, stayed
 * green. Touch is now filtered on the event's own `pointerType`, which the
 * browser always states.
 */
class FakeMediaQueryList {
  matches: boolean;

  private readonly listeners = new Set<() => void>();

  constructor(
    readonly media: string,
    matches: boolean,
  ) {
    this.matches = matches;
  }

  addEventListener(type: string, listener: () => void) {
    if (type === "change") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: () => void) {
    if (type === "change") {
      this.listeners.delete(listener);
    }
  }

  /** Flips the query and notifies, the way a real preference change does. */
  set(matches: boolean) {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

let queries: Map<string, FakeMediaQueryList>;

function stubMatchMedia(initial: Record<string, boolean>) {
  queries = new Map(
    Object.entries(initial).map(([media, matches]) => [
      media,
      new FakeMediaQueryList(media, matches),
    ]),
  );

  window.matchMedia = ((media: string) => {
    const query = queries.get(media);
    if (!query) {
      throw new Error(
        `Starfield asked for an unexpected media query: ${JSON.stringify(media)}. ` +
          `Add it to the stub in this test deliberately, rather than letting it ` +
          `default to false.`,
      );
    }
    return query;
  }) as unknown as typeof window.matchMedia;
}

/** Lets one animation frame run, inside `act` so React sees the write. */
async function nextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function fieldOf(container: HTMLElement): HTMLElement {
  const field = container.querySelector<HTMLElement>(".starfield");
  if (!field) {
    throw new Error("no .starfield element was rendered");
  }
  return field;
}

/**
 * jsdom's viewport is 1024x768, so this is a point right of and below centre —
 * both offsets are therefore positive, which is what the sign assertions below
 * rely on.
 */
function movePointerRightOfCentre() {
  fireEvent.pointerMove(window, { clientX: 1000, clientY: 700 });
}

beforeEach(() => {
  stubMatchMedia({ [REDUCED_MOTION]: false });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Starfield", () => {
  test("renders three depth layers inside one decorative container", () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    // Decorative, so it must be invisible to assistive technology and must not
    // intercept clicks aimed at the content in front of it.
    expect(field.getAttribute("aria-hidden")).toBe("true");
    expect(field.className).toContain("pointer-events-none");

    // Three, because one layer cannot parallax — everything would slide
    // together and read as the page moving rather than as depth.
    const layers = field.querySelectorAll(".starfield__layer");
    expect(layers).toHaveLength(3);

    // Each layer needs its own drift child; the drift is a second, independent
    // transform, and sharing one element would mean the two motions overwrite
    // each other.
    for (const layer of layers) {
      expect(layer.querySelector(".starfield__drift")).not.toBeNull();
    }
  });

  test("writes the cursor offset as custom properties once the pointer moves", async () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    // At rest the layers are positioned by the CSS fallbacks, so nothing has
    // been written yet.
    expect(field.style.getPropertyValue("--px")).toBe("");

    movePointerRightOfCentre();
    await nextFrame();

    const px = field.style.getPropertyValue("--px");
    const py = field.style.getPropertyValue("--py");

    expect(px).not.toBe("");
    expect(py).not.toBe("");

    // Down and to the right of centre, so both are positive. A sign error here
    // would make the field move against the cursor, which looks like a bug and
    // would still satisfy a "not empty" assertion.
    expect(Number.parseFloat(px)).toBeGreaterThan(0);
    expect(Number.parseFloat(py)).toBeGreaterThan(0);
  });

  test("follows rather than snaps: the first frame is a fraction of the way", async () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    movePointerRightOfCentre();
    await nextFrame();

    // The cursor sits at ~0.95 of the way to the right edge. The layer should
    // have moved a small fraction of that on the first frame — if it had
    // arrived outright, the easing is gone and the field would be pinned to
    // the cursor.
    const first = Number.parseFloat(field.style.getPropertyValue("--px"));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10);
  });

  test("does not move at all under prefers-reduced-motion", async () => {
    stubMatchMedia({ [REDUCED_MOTION]: true });

    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    movePointerRightOfCentre();
    await nextFrame();

    // No listener, no frame, and no custom property — so the CSS keeps the
    // layers at rest. Asserting on the property rather than on the listener
    // count is deliberate: it is what actually decides whether anything moves.
    expect(field.style.getPropertyValue("--px")).toBe("");
    expect(field.style.getPropertyValue("--py")).toBe("");
  });

  test("ignores a touch drag, which would otherwise swim while the page scrolls", async () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    // A finger is not a cursor, and dragging to scroll arrives as exactly this
    // event. Filtering on `pointerType` rather than on a `(pointer: fine)`
    // query is what keeps the field still on a phone — and on desktop, where
    // that query reports `none` often enough to have switched the parallax off
    // entirely.
    fireEvent.pointerMove(window, {
      clientX: 1000,
      clientY: 700,
      pointerType: "touch",
    });
    await nextFrame();

    expect(field.style.getPropertyValue("--px")).toBe("");
  });

  test("follows a pen, which hovers and so does have a position", async () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    fireEvent.pointerMove(window, {
      clientX: 1000,
      clientY: 700,
      pointerType: "pen",
    });
    await nextFrame();

    expect(field.style.getPropertyValue("--px")).not.toBe("");
  });

  test("stops a field that is already moving when reduced motion is turned on", async () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    movePointerRightOfCentre();
    await nextFrame();
    expect(field.style.getPropertyValue("--px")).not.toBe("");

    // The preference is watched rather than read once, so a reader who turns
    // it on mid-session is not left with a field that keeps moving.
    await act(async () => {
      queries.get(REDUCED_MOTION)?.set(true);
    });

    expect(field.style.getPropertyValue("--px")).toBe("");
    expect(field.style.getPropertyValue("--py")).toBe("");
  });

  test("stops writing once the layers have settled", async () => {
    const { container } = render(<Starfield />);
    const field = fieldOf(container);

    movePointerRightOfCentre();

    // Enough frames for the easing to converge. The value must stop changing
    // on its own — a loop that keeps writing the same transform every frame is
    // the cost this design exists to avoid.
    for (let i = 0; i < 200; i += 1) {
      await nextFrame();
    }

    const settled = field.style.getPropertyValue("--px");
    await nextFrame();

    expect(field.style.getPropertyValue("--px")).toBe(settled);
  });
});

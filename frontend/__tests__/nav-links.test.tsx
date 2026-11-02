import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { NavLinks } from "@/components/layout/nav-links";
import { landingNav } from "@/lib/landing";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn<() => string>(() => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

type ObserverEntry = { target: { id: string }; isIntersecting: boolean };

/**
 * A stand-in for the browser's IntersectionObserver, which jsdom does not
 * implement at all. It lets a test say exactly which sections are in view,
 * which is the only way to exercise the highlighting without a browser.
 *
 * It validates `rootMargin` the way the browser does. A permissive fake is
 * worse than none: the real constructor rejects anything that is not pixels or
 * percentages, and when this fake accepted `"-5rem 0px -70% 0px"` the whole
 * scroll-spy threw on mount in every browser while every test stayed green.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  observed: string[] = [];
  disconnected = false;
  readonly rootMargin: string | undefined;

  private readonly callback: (entries: ObserverEntry[]) => void;

  constructor(
    callback: (entries: ObserverEntry[]) => void,
    options?: IntersectionObserverInit,
  ) {
    const rootMargin = options?.rootMargin;
    if (rootMargin !== undefined) {
      const legal = rootMargin
        .trim()
        .split(/\s+/)
        .every((part) => /^-?\d*\.?\d+(px|%)$/.test(part));
      if (!legal) {
        throw new SyntaxError(
          "Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.",
        );
      }
    }

    this.rootMargin = rootMargin;
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element.id);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  /** Test-only: report entries as though the browser had observed them. */
  emit(entries: ObserverEntry[]) {
    this.callback(entries);
  }
}

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Renders the nav alongside the sections it points at. Both land in the DOM in
 * the same commit, so the nav's effect can find them.
 */
function renderNav() {
  const result = render(
    <>
      <NavLinks />
      {landingNav.map((section) => (
        <section key={section.id} id={section.id} />
      ))}
    </>,
  );

  const observer = FakeIntersectionObserver.instances[0];
  if (!observer) {
    throw new Error("NavLinks did not observe anything");
  }
  return { observer, unmount: result.unmount };
}

function currentOf(name: string) {
  return screen.getByRole("link", { name })?.getAttribute("aria-current");
}

describe("NavLinks", () => {
  test("observes every section the navigation points at", () => {
    const { observer } = renderNav();

    expect(observer.observed.sort()).toEqual(
      landingNav.map((section) => section.id).sort(),
    );
  });

  test("opens the observing band below the sticky header", () => {
    const { observer } = renderNav();

    // The top edge has to be a pixel value or the browser refuses to build the
    // observer at all — the fake enforces the same rule, so a `rem` here fails
    // this test rather than passing it and breaking in a real browser.
    const [top, right, bottom, left] = (observer.rootMargin ?? "").split(/\s+/);
    expect(top).toMatch(/^-\d+(\.\d+)?px$/);
    expect(Number.parseFloat(top)).toBeLessThan(0);
    expect(right).toBe("0px");
    expect(bottom).toMatch(/^-\d+(\.\d+)?%$/);
    expect(left).toBe("0px");
  });

  test("takes its top offset from the page's scroll padding", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      scrollPaddingTop: "112px",
    } as unknown as CSSStyleDeclaration);

    const { observer } = renderNav();

    // The anchor offset and the observing band are one measurement in two
    // places; retuning scroll-padding-top must move both.
    expect(observer.rootMargin?.startsWith("-112px ")).toBe(true);
  });

  test("marks the route as current before any section is reached", () => {
    renderNav();

    // At the top of the page the reader is on the landing route, in no
    // particular section.
    expect(currentOf("Home")).toBe("page");
    expect(currentOf("What's coming")).toBeNull();
  });

  test("marks the section the reader is inside, and releases the route", () => {
    const { observer } = renderNav();

    act(() => {
      observer.emit([{ target: { id: "features" }, isIntersecting: true }]);
    });

    // Exactly one entry is marked, so the highlight answers one question.
    expect(currentOf("What's coming")).toBe("location");
    expect(currentOf("Home")).toBeNull();
    expect(currentOf("How it works")).toBeNull();
  });

  test("returns to the route once the section is scrolled past", () => {
    const { observer } = renderNav();

    act(() => {
      observer.emit([{ target: { id: "features" }, isIntersecting: true }]);
    });
    act(() => {
      observer.emit([{ target: { id: "features" }, isIntersecting: false }]);
    });

    expect(currentOf("Home")).toBe("page");
    expect(currentOf("What's coming")).toBeNull();
  });

  test("keeps the higher section marked while two overlap mid-scroll", () => {
    const { observer } = renderNav();

    act(() => {
      observer.emit([
        { target: { id: "features" }, isIntersecting: true },
        { target: { id: "community" }, isIntersecting: true },
      ]);
    });

    expect(currentOf("What's coming")).toBe("location");
    expect(currentOf("Community")).toBeNull();
  });

  test("stops observing when it unmounts", () => {
    const { observer, unmount } = renderNav();

    expect(observer.disconnected).toBe(false);
    unmount();
    // Without this the observer would keep firing into an unmounted tree.
    expect(observer.disconnected).toBe(true);
  });

  test("drops the section mark when the reader leaves the route", () => {
    const view = render(
      <>
        <NavLinks />
        {landingNav.map((section) => (
          <section key={section.id} id={section.id} />
        ))}
      </>,
    );

    act(() => {
      FakeIntersectionObserver.instances[0].emit([
        { target: { id: "features" }, isIntersecting: true },
      ]);
    });
    expect(currentOf("What's coming")).toBe("location");

    // The section belonged to the landing page. Nothing it said about where
    // the reader was may stay lit once they are somewhere else.
    usePathnameMock.mockReturnValue("/somewhere-else");
    view.rerender(
      <>
        <NavLinks />
        {landingNav.map((section) => (
          <section key={section.id} id={section.id} />
        ))}
      </>,
    );

    expect(currentOf("What's coming")).toBeNull();
    expect(currentOf("Home")).toBeNull();
  });

  test("does nothing outside the route its anchors belong to", () => {
    usePathnameMock.mockReturnValue("/somewhere-else");
    render(
      <>
        <NavLinks />
        {landingNav.map((section) => (
          <section key={section.id} id={section.id} />
        ))}
      </>,
    );

    // "/#features" is a section of the landing page; from another route it
    // says nothing about where the reader is, so nothing is observed.
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer?.observed ?? []).toEqual([]);
    expect(currentOf("Home")).toBeNull();
  });
});

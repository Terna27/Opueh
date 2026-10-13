import { landingNav, sectionHref } from "./landing";

/**
 * Navigation configuration and route-matching helpers.
 *
 * This list is the single place that changes when a milestone adds a route to
 * the shell. It deliberately contains only destinations that actually exist:
 * a nav entry pointing at an unbuilt page would render a broken link, and
 * every milestone that adds a page is responsible for adding it here.
 */

export type NavLink = {
  readonly href: string;
  readonly label: string;
};

/**
 * Primary navigation.
 *
 * The landing page is currently the only route, so most of the shell's
 * navigation points at sections within it. Those entries are written as
 * `/#section` rather than `#section`: the longer form also works from a route
 * that is not the landing page — the 404, for instance — where a bare fragment
 * would do nothing at all.
 *
 * Feed, profile and notification routes are added by the milestones that build
 * them.
 */
export const primaryNav: readonly NavLink[] = [
  { href: "/", label: "Home" },
  ...landingNav.map((section) => ({
    href: sectionHref(section.id),
    label: section.label,
  })),
];

/**
 * Reports whether `href` should be rendered as the active destination for the
 * current `pathname`.
 *
 * In-page anchors are never active here: a pathname carries no fragment, so
 * whether one is "current" depends on where the reader has scrolled to, which
 * `anchorIdFor` and `currentSection` answer instead.
 *
 * "/" matches only exactly — otherwise it would be active on every route. Any
 * other entry also matches its subroutes, so a nested page keeps its section
 * highlighted (e.g. "/profile" stays active on "/profile/settings").
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href.includes("#")) {
    return false;
  }

  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The section `href` points at, if that section is on the route the reader is
 * currently viewing.
 *
 * Returns null for a plain route link, and null for an anchor into a different
 * page — "/#features" is a section of the landing page, and it says nothing
 * about where the reader is while they are on the 404.
 */
export function anchorIdFor(pathname: string, href: string): string | null {
  const hash = href.indexOf("#");
  if (hash === -1) {
    return null;
  }

  const path = href.slice(0, hash);
  const fragment = href.slice(hash + 1);

  if (!fragment || path !== pathname) {
    return null;
  }

  return fragment;
}

/**
 * Which of `orderedIds` is the section the reader is currently inside.
 *
 * The first match in document order wins. Sections can overlap in the
 * viewport, and when they do the one that started higher up is the one the
 * reader is reading — picking the last, or the tallest, would light up a
 * section that has only just appeared at the bottom of the screen.
 *
 * Split out from the component so the choice is testable without a browser.
 */
export function currentSection(
  orderedIds: readonly string[],
  visibleIds: ReadonlySet<string>,
): string | null {
  return orderedIds.find((id) => visibleIds.has(id)) ?? null;
}

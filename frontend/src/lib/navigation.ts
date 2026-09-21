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
 * Currently the shell owns one route. Feed, profile and notifications are
 * added by the milestones that build them.
 */
export const primaryNav: readonly NavLink[] = [
  { href: "/", label: "Home" },
];

/**
 * Reports whether `href` should be rendered as the active destination for the
 * current `pathname`.
 *
 * "/" matches only exactly — otherwise it would be active on every route. Any
 * other entry also matches its subroutes, so a nested page keeps its section
 * highlighted (e.g. "/profile" stays active on "/profile/settings").
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

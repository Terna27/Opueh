/**
 * Site-wide identity. One source of truth for the platform name and copy, so
 * the metadata, header, footer and landing page cannot drift apart.
 */
export const site = {
  name: "Opueh",
  tagline: "Watch, share, and join the conversation.",
  description:
    "Opueh is a social video streaming platform: share videos, follow the people you care about, and join the conversation.",
} as const;

/**
 * The full document title.
 *
 * Declared once because two places need the identical string: the root
 * layout's `title.default` (which supplies it to every page that does not set
 * its own) and the home page, which states it outright.
 */
export const siteTitle = `${site.name} — ${site.tagline}`;

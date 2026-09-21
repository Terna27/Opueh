/**
 * Site-wide identity. One source of truth for the platform name and copy, so
 * the metadata, header and footer cannot drift apart.
 */
export const site = {
  name: "Opueh",
  tagline: "Watch, share, and join the conversation.",
  description:
    "Opueh is a social video streaming platform: share videos, follow the people you care about, and join the conversation.",
} as const;

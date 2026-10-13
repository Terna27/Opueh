/**
 * Landing-page content.
 *
 * Copy lives here rather than inline in the JSX for the same reason `site.ts`
 * exists: the section ids are shared by two places that must agree — the
 * sections themselves, and every link that points at them — so a typo in one
 * would otherwise produce a silently dead anchor.
 *
 * The copy is deliberately written as intent, not as shipped fact. Opueh's
 * feed, profiles and conversations are not built yet, and nothing on this page
 * should imply that they are.
 */

import { site } from "./site";

/** An icon name. The icon set must supply every member of this union. */
export type LandingIcon =
  | "bell"
  | "comments"
  | "link"
  | "mail"
  | "message"
  | "play"
  | "search"
  | "upload"
  | "user"
  | "users";

/** The sections that other elements link to, by anchor. */
export const landingSections = {
  howItWorks: { id: "how-it-works", label: "How it works" },
  features: { id: "features", label: "What's coming" },
  community: { id: "community", label: "Community" },
} as const;

/**
 * The landing sections in page order, for the places that list them — the
 * header navigation and the footer.
 */
export const landingNav = [
  landingSections.howItWorks,
  landingSections.features,
  landingSections.community,
] as const;

/** Builds the `/#id` href for a landing section. */
export function sectionHref(id: string): string {
  return `/#${id}`;
}

export const hero = {
  eyebrow: "Social video",
  // The tagline doubles as the page's top-level heading rather than being
  // written a second time here, so the brand line has exactly one definition.
  headline: site.tagline,
  description:
    "Opueh is being built as a place to publish video and talk about it in the same room. Accounts are open now — you can create one and log in, though the feed and profiles are still to come.",
  // Real hrefs rather than section ids: these now lead to the auth pages, so
  // a call to action is something a visitor can actually complete.
  primaryCta: { label: "Create your account", href: "/register" },
  secondaryCta: { label: "Log in", href: "/login" },
} as const;

export const howItWorks = {
  eyebrow: "The loop",
  title: "How Opueh is meant to work",
  description:
    "Four steps, in order. This is the shape of the product rather than a description of something you can use today.",
  steps: [
    {
      icon: "link",
      title: "Connect",
      description:
        "Follow the people and communities you care about, and build a feed around them.",
    },
    {
      icon: "upload",
      title: "Share",
      description:
        "Publish video with a title and a description, from whatever device you have to hand.",
    },
    {
      icon: "message",
      title: "Discuss",
      description:
        "Comment on what you watch, so the conversation stays beside the video instead of somewhere else.",
    },
    {
      icon: "users",
      title: "Build communities",
      description:
        "Give a group a place to keep talking between posts, around a shared interest.",
    },
  ],
} as const;

export const featurePreview = {
  eyebrow: "Roadmap",
  title: "What's coming",
  description:
    "None of this is switched on yet. Opueh is being built one piece at a time, and each of these arrives in a later milestone.",
  features: [
    {
      icon: "play",
      title: "Social feed",
      description:
        "Video from the accounts you follow, with the conversation attached to each one.",
    },
    {
      icon: "comments",
      title: "Community interaction",
      description:
        "Discussions on a video, and spaces where a community keeps talking between posts.",
    },
    {
      icon: "user",
      title: "Profiles",
      description:
        "A page for each person: what they have published, and who they follow.",
    },
    {
      icon: "bell",
      title: "Notifications",
      description:
        "Know when someone follows you, replies to you, or shares something new.",
    },
    {
      icon: "mail",
      title: "Conversations",
      description:
        "Direct messages for the discussions that are not meant for the whole feed.",
    },
  ],
} as const;

export const community = {
  eyebrow: "Community",
  title: "Built around people, not reach",
  description:
    "Opueh is meant to work for small groups as well as large ones. These are the four things a community needs to hold together, whatever shape the platform ends up taking.",
  pillars: [
    {
      icon: "search",
      title: "Discover people",
      description: "Find people and communities by what they publish.",
    },
    {
      icon: "message",
      title: "Join discussions",
      description: "Add your take to a video, or to a thread someone else began.",
    },
    {
      icon: "upload",
      title: "Share ideas",
      description: "Publish video, describe it, and let people respond.",
    },
    {
      icon: "users",
      title: "Grow a community",
      description: "Build a space around a shared interest, with people who return.",
    },
  ],
} as const;

export const closingCta = {
  title: "The conversation is the point",
  description:
    "Opueh is being built in the open, one milestone at a time. Accounts are open now; the feed, profiles and conversations come next.",
  primaryCta: { label: "Create your account", href: "/register" },
  secondaryCta: {
    label: "How it works",
    href: sectionHref(landingSections.howItWorks.id),
  },
} as const;

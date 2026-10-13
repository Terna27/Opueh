import type { Metadata } from "next";

import { ClosingCta } from "@/components/landing/closing-cta";
import { Community } from "@/components/landing/community";
import { FeaturePreview } from "@/components/landing/feature-preview";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { site, siteTitle } from "@/lib/site";

/**
 * `absolute` on the title is deliberate. The root layout applies a
 * `%s · Opueh` template to any page that sets a title, which would turn the
 * home page's title into "Opueh — Watch, share... · Opueh". The landing page
 * is the one route that should carry the full brand line unsuffixed.
 *
 * Both strings come from `lib/site.ts` rather than being written out here, so
 * the page title and the description cannot drift from the ones the layout,
 * the header and the footer already use.
 */
export const metadata: Metadata = {
  title: { absolute: siteTitle },
  description: site.description,
};

/**
 * The landing page.
 *
 * A Server Component. Every section below is static markup, and the only
 * interactive parts of the page — the header's navigation — live in the
 * layout, so none of this ships to the browser as JavaScript.
 *
 * The page deliberately ends on anchors rather than a sign-up form. Opueh has
 * no account system yet, and a call to action that cannot be completed is
 * worse than one that scrolls to what it promised.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <FeaturePreview />
      <Community />
      <ClosingCta />
    </>
  );
}

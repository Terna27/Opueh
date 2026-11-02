import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { featurePreview, landingSections } from "@/lib/landing";

import { LandingIcon } from "./icons";
import { Section } from "./section";

/**
 * Previews of the capabilities the later milestones build.
 *
 * Nothing here is interactive and nothing is wired to an API — the section
 * heading and its description say so outright, which is what keeps the copy
 * from reading as a claim about a product that works today.
 *
 * A list rather than a grid of divs: five capabilities of equal standing, and
 * a screen reader should hear how many there are.
 *
 * The first entry spans two columns on wide screens. Five cards in a
 * three-column grid would otherwise leave a hole in the last row, and a gap
 * in a grid reads as a rendering fault rather than as a design.
 */
export function FeaturePreview() {
  return (
    <Section
      id={landingSections.features.id}
      eyebrow={featurePreview.eyebrow}
      title={featurePreview.title}
      description={featurePreview.description}
      tone="surface"
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featurePreview.features.map((feature, index) => (
          <li
            key={feature.title}
            className={cn(index === 0 && "sm:col-span-2")}
          >
            <Card
              className={cn(
                "flex h-full flex-col gap-3 p-6",
                // The wide card lays its icon out beside the text so the extra
                // width is used rather than left as empty space.
                index === 0 && "sm:flex-row sm:items-start sm:gap-5",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <LandingIcon name={feature.icon} />
              </span>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-base font-semibold">{feature.title}</h3>
                <p className="text-sm leading-6 text-muted">
                  {feature.description}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

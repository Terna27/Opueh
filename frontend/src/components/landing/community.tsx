import { Card } from "@/components/ui/card";
import { community, landingSections } from "@/lib/landing";

import { LandingIcon } from "./icons";
import { Section } from "./section";

/**
 * What a community needs in order to hold together.
 *
 * One card holding four rows, deliberately unlike the roadmap section above
 * it: those are separate capabilities, these are parts of one idea, and the
 * shared surface says so before the text does.
 *
 * The copy stays at the level of intent. It names no endpoint, no data shape
 * and no specific flow, so nothing here has to be undone when the API for
 * these features is actually designed.
 */
export function Community() {
  return (
    <Section
      id={landingSections.community.id}
      eyebrow={community.eyebrow}
      title={community.title}
      description={community.description}
    >
      <Card className="p-6 sm:p-8">
        <ul className="grid gap-6 sm:grid-cols-2 sm:gap-8">
          {community.pillars.map((pillar) => (
            <li key={pillar.title} className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <LandingIcon name={pillar.icon} />
              </span>

              <div>
                <h3 className="text-base font-semibold">{pillar.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">
                  {pillar.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

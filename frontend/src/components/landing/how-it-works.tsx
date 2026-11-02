import { Card } from "@/components/ui/card";
import { howItWorks, landingSections } from "@/lib/landing";

import { LandingIcon } from "./icons";
import { Section } from "./section";

/**
 * The four-step loop the product is designed around.
 *
 * An ordered list, because the order is the content: Connect leads to Share
 * leads to Discuss leads to a community. The connecting chevrons are
 * decoration for the same reason — they restate what the list already means,
 * so they are hidden from assistive technology and only drawn where the steps
 * sit side by side.
 */
export function HowItWorks() {
  return (
    <Section
      id={landingSections.howItWorks.id}
      eyebrow={howItWorks.eyebrow}
      title={howItWorks.title}
      description={howItWorks.description}
    >
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {howItWorks.steps.map((step, index) => (
          <li key={step.title} className="relative">
            <Card className="flex h-full flex-col gap-3 p-6">
              <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <LandingIcon name={step.icon} />
              </span>

              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                Step {index + 1}
              </p>

              <h3 className="text-base font-semibold">{step.title}</h3>

              <p className="text-sm leading-6 text-muted">
                {step.description}
              </p>
            </Card>

            {index < howItWorks.steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-1/2 -right-3 hidden -translate-y-1/2 text-muted lg:block"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

import type { ReactNode } from "react";

import { Container } from "@/components/layout/container";

/**
 * The shell shared by /login and /register.
 *
 * A route group rather than a shared component, so the two pages keep their
 * own metadata and their own headings while the centring and the card come
 * from one place.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="flex flex-1 items-start justify-center py-12 sm:py-20">
      <div className="w-full max-w-sm">{children}</div>
    </Container>
  );
}

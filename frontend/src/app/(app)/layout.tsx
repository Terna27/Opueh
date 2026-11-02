import type { ReactNode } from "react";

import { RequireSession } from "@/components/account/require-session";
import { Container } from "@/components/layout/container";

/**
 * The shell for authenticated pages.
 *
 * A route group, so /onboarding and /settings/profile share one guard and one
 * measure without either page having to remember to apply them. A page added
 * here is guarded by existing, not by remembering to be.
 *
 * `RequireSession` is a Client Component wrapping server-rendered children.
 * That is deliberate and costs nothing: the children are still rendered on the
 * server and passed through as an already-built tree, so the guard decides
 * whether to show them rather than what they contain.
 *
 * The width is narrower than the landing page's: this is reading-width content,
 * not a marketing layout.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <Container className="flex flex-1 flex-col py-10 sm:py-14">
        <div className="w-full max-w-2xl">{children}</div>
      </Container>
    </RequireSession>
  );
}

import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { SessionProvider } from "@/lib/auth/session-context";

/*
 * Shared harness for components that read the session.
 *
 * The header now renders session controls, so anything that renders the shell
 * — the header on its own, or a whole page through the landing links test —
 * needs the provider around it.
 *
 * Test files still declare their own `vi.mock("next/navigation", ...)`, since
 * a module mock is hoisted per file and cannot be shared from here; this only
 * supplies the wrapper and the fetch stub.
 */

/** A fetch stub answering as a signed-out visitor. */
export function signedOutFetch() {
  return vi.fn(async () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "You are not signed in." },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

export function renderWithSession(ui: ReactElement): RenderResult {
  return render(<SessionProvider>{ui}</SessionProvider>);
}

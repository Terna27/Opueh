import { normalizeApiBaseUrl } from "@/lib/env";

import { assertServer } from "./server-only";

assertServer("src/lib/api/env.ts");

/**
 * Origin of the Opueh Go API, e.g. "http://localhost:8080". No trailing slash.
 *
 * Read from `API_BASE_URL`, deliberately NOT a `NEXT_PUBLIC_` variable: only
 * the server talks to the Go API, so the browser has no reason to know the
 * origin and no reason to carry it in the bundle.
 *
 * A function rather than a module-level constant so the value is resolved when
 * a request is actually made, which keeps it stubbable in tests and avoids
 * freezing a value read at import time. Validation still happens before any
 * request is sent, and its errors are the same fail-fast ones the public
 * variable raises.
 */
export function apiBaseUrl(): string {
  return normalizeApiBaseUrl(process.env.API_BASE_URL, process.env.NODE_ENV, {
    variable: "API_BASE_URL",
    credentialReason:
      "This value is read from server configuration and appears in logs and error reports.",
  });
}

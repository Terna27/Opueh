/**
 * Server-only boundary.
 *
 * Everything under `src/lib/api/` runs in the Next.js server. Auth tokens are
 * held in httpOnly cookies precisely so browser code cannot reach them, so a
 * Client Component importing one of these modules is a real defect, not a
 * style problem.
 *
 * `assertServer` turns that into a loud failure instead of a silent one. It is
 * a runtime check rather than the `server-only` package so that no dependency
 * is added for a guard that is one line long.
 */
export function assertServer(moduleName: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${moduleName} is server-only and was imported into browser code. Auth tokens are held in httpOnly cookies and must never be read from the client.`,
    );
  }
}

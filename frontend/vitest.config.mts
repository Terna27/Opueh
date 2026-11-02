import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Setup follows the Next.js testing guide (node_modules/next/dist/docs/
// 01-app/02-guides/testing/vitest.md), with two deviations:
//
//   - `resolve.tsconfigPaths` replaces the `vite-tsconfig-paths` plugin the
//     guide recommends; Vite resolves tsconfig paths natively now, so the
//     extra dependency is unnecessary.
//   - `setupFiles` unmounts rendered components between tests. The guide's
//     example does not need it, but React Testing Library only auto-registers
//     its cleanup when a global `afterEach` exists, and Vitest does not
//     provide globals by default.
//
// Test files live in __tests__/ at the project root.
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Building a jsdom environment dominates this suite's runtime. vmThreads
    // creates one per worker instead of one per file while keeping files
    // isolated from each other.
    pool: "vmThreads",
  },
});

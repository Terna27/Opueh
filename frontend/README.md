# Opueh Frontend

Next.js frontend for the Opueh social video streaming platform. The Go API
lives at the repository root; see [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
for the backend's architecture and [../README.md](../README.md) for running it.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19
- TypeScript
- Tailwind CSS v4 (tokens declared in `src/app/globals.css`)
- Vitest + React Testing Library

## Prerequisites

Node.js 20.9+ (Next.js 16's floor). This project is developed on Node 24 LTS.
If you use `nvm`, `nvm install` picks up [.nvmrc](.nvmrc).

## Setup

```bash
npm install
cp .env.example .env.local   # defaults already point at the local Go API
npm run dev                  # http://localhost:3000
```

The dev server runs on port 3000 because that is the origin the backend's
`ALLOWED_ORIGINS` and `APP_URL` allow by default (see the repo-root
`.env.example`). Changing it means changing the backend too.

## Commands

```bash
npm run dev        # development server on :3000
npm run build      # production build
npm start          # serve the production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest, single run
npm run test:watch # Vitest, watch mode
```

## Layout

```
src/
  app/                    routes (file-system routing)
    layout.tsx            root layout: metadata, fonts, header, footer
    page.tsx              home route
    error.tsx             route error boundary
    loading.tsx           route loading UI
    not-found.tsx         404
    globals.css           design tokens + base styles
  components/
    layout/               the application shell (header, footer, nav)
  lib/
    env.ts                validated environment configuration
    navigation.ts         nav destinations + active-route matching
    site.ts               platform name and copy
__tests__/                Vitest suites
```

Directories are added when they hold something, not in advance. `components/ui`,
`hooks` and `services` arrive with the milestones that need them.

## Configuration

Read and validated in [src/lib/env.ts](src/lib/env.ts).

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Production | Public origin of the Go API, no trailing slash. Defaults to `http://localhost:8080` outside production; a production build without it fails on purpose. |

`NEXT_PUBLIC_`-prefixed values are compiled into the browser bundle and are
public. Never put a secret here — the module rejects embedded credentials.

## Testing notes

- Test files live in `__tests__/` at the project root.
- `vitest.setup.ts` unmounts rendered components between tests. React Testing
  Library only auto-registers its cleanup when a global `afterEach` exists,
  which Vitest does not provide by default.
- Server Components cannot be unit tested by Vitest — the Next.js docs
  recommend end-to-end tests for async ones. The shell's components are
  synchronous, so they render directly.

## Milestone status

Milestone 1 (foundation) is complete: the shell runs, navigates and is tested.
The landing page, authentication UI and everything after it are not built yet.

Routes that exist today are only `/`. Any other navigation destination is
added by the milestone that builds its page — no placeholder routes are
committed ahead of their milestone.

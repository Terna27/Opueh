# Architecture — Opueh Frontend

This document records the architectural decisions for the Opueh web client. It
is the reference every frontend milestone builds on, and it is the companion to
`docs/ARCHITECTURE.md`, which covers the Go backend. Changes to these decisions
require updating this document first.

Last updated: Milestone 5.

## 1. Application shape: a Next.js app with a server layer

One Next.js App Router application. It is not a static client that happens to be
served by Node — the server half is load-bearing, and sections 2 and 3 are the
reason.

The stack is Next.js 16 with Turbopack, React 19, TypeScript, and Tailwind CSS
v4. Paths, conventions and APIs move between majors, so the bundled guides in
`node_modules/next/dist/docs/` are the reference for anything this document does
not settle. `next dev` writes an `AGENTS.md` saying exactly that.

## 2. The browser never talks to the Go API

```
browser ──same-origin──▶ Next route handler ──Bearer──▶ Go API
   │  httpOnly cookies         │  holds the tokens
   └─ no API origin, no token  └─ sets and clears cookies
```

Every browser request goes to this app's own `/api/*` routes. Those routes hold
the tokens, attach the `Bearer` header upstream, and translate the response.

The consequence worth stating plainly: **there is no API origin in the client
bundle.** `API_BASE_URL` is read from server configuration and deliberately not
prefixed `NEXT_PUBLIC_` (see `src/lib/api/env.ts`). A component that reached for
`process.env.NEXT_PUBLIC_API_BASE_URL` would undo this in one line, and the
symptom would not be a build error — it would be an origin that appears in the
bundle and a CORS policy that suddenly matters.

Deliberately NOT chosen: calling the API directly from the browser with the
token in memory. It is less code, and it means an XSS bug can read a live token
out of JavaScript and exfiltrate it. The proxy exists so that it cannot.

### Layers

| Layer | Location | Runs | Responsibility |
|---|---|---|---|
| Contract | `src/lib/api/` | Server only | Typed calls to the Go API; every response parsed into a result, never a raw `fetch` |
| Proxy | `src/app/api/**/route.ts` | Server only | Same-origin boundary, token attachment, cookie writes |
| Client data | `src/lib/account/client.ts`, `src/lib/auth/client.ts` | Browser | Calls this app's own routes; never the Go API |
| UI | `src/app/`, `src/components/` | Both | Rendering and interaction |

The contract layer asserts its own boundary. `assertServer` in
`src/lib/api/server-only.ts` makes importing a server module into a Client
Component a runtime error rather than a confusing bundling failure.

## 3. Cookie strategy

Both tokens live in `httpOnly` cookies. Nothing about the session is reachable
from JavaScript, so an XSS bug can make requests as the user but cannot steal a
token that outlives the page.

- **Names**: `opueh_access` and `opueh_refresh`, defined once in
  `src/lib/api/cookie-names.ts`.
- **`__Host-` prefix in production.** Browsers only accept it on a Secure
  cookie with `Path=/` and no `Domain`; given those constraints it makes the
  cookie impossible for a sibling subdomain to overwrite. It is not applied in
  development, because a plain-http dev server could not set it and a cookie the
  browser rejects is a session that never persists.
- **`SameSite=Lax`**, which keeps the cookies off cross-site POSTs. This is the
  primary CSRF defence. The `Origin` check in the route handlers is the second
  layer, and a missing `Origin` is refused rather than assumed benign.
- **Rotation on every refresh.** The backend treats a replayed refresh token as
  theft evidence and revokes the whole family, so the token is rotated, never
  reused.

`cookie-names.ts` imports nothing at all, and that is deliberate: `proxy.ts`
needs the names, and Next's guidance for that file is not to rely on shared
modules or globals. Keeping the `__Host-` rule in a module with no dependencies
means the two copies cannot drift into a production-only failure to recognise a
session that exists.

### Why the proxy layer writes cookies, and not the pages

A stale access cookie has to be rotated, and rotating writes cookies. A Server
Component cannot write cookies. So the pages that need a live session fetch
through `/api/*` rather than reading the token directly — `/settings/profile`
and `/onboarding` are Client Components for this reason, not for interactivity.

The one exception is the public profile, which needs no token at all and is a
Server Component calling the contract directly (`src/app/u/[username]/page.tsx`).

## 4. The guard model: three layers, one authority

Authorization is not decided in one place, and the split is deliberate.

1. **`src/proxy.ts` — optimistic, and honest about it.** Next 16 renamed the
   `middleware.ts` convention to `proxy.ts` (same function, same
   `config.matcher`). It answers exactly one question: *is any session cookie
   present?* It cannot verify a JWT — the signing key is server-side, and doing
   crypto on every request is not this layer's job — and it cannot know whether
   a user has finished onboarding, which needs a database read. So it is biased
   towards letting people in. It is genuinely useful anyway: it catches the
   ordinary case of someone following a link with no session at all, before a
   round trip, and it redirects them already knowing where they were going.
2. **`RequireSession`** (`src/components/account/require-session.tsx`) — the
   real client-side gate, driven by the session state the app already maintains
   from the API. It keeps three states distinct: `loading` renders a sized
   placeholder rather than guessing; `signed-out` redirects to
   `/login?next=…`; `unavailable` offers a retry and **does not** redirect,
   because an unreachable API is not a statement about the session.
3. **The route handlers and the Go API** — the actual boundary. Every `/api/*`
   route refuses a call without a token the API accepts. A forged cookie gets
   past the proxy and is stopped here.

The `matcher` lists the protected routes explicitly (`/onboarding`,
`/settings/:path*`) rather than matching everything-except-public. The
inversion matters: with a negative matcher, forgetting to exclude a new public
page makes it start demanding a login, and without a matcher at all the proxy
runs on every request including static assets, where an auth redirect pointed at
a CSS file breaks pages in a way that looks nothing like its cause.

### `?next=` is an allowlist, not string concatenation

Both the proxy and the guard want to return a user where they were headed. A
`next` value taken from the URL and handed to `router.push` is an open redirect
unless it is checked, and `startsWith("/")` is not sufficient: `//evil.example`
is protocol-relative. `safeNext` (`src/lib/account/next-param.ts`) rejects
anything that does not start with `/`, or that starts with `//` or `/\`. It has
its own test file, and the login page applies it server-side before the value
reaches the form.

## 5. Error model: every failure is one shape

The backend returns `{"error": {"code", "message"}}`. `parseApiError`
(`src/lib/api/errors.ts`) maps that onto an `ApiError`, and the union of
backend codes is written out explicitly in `BACKEND_ERROR_CODES`. A code that is
not in the union is normalised to `INTERNAL`.

That normalisation is a real hazard and the reason the union is maintained by
hand: `USER_NOT_FOUND` and `CATEGORY_NOT_FOUND` were added for Milestone 5
because without them the public profile page could not tell a 404 from a
failure, and would have rendered "an unexpected error occurred" for a perfectly
ordinary miss.

Two codes are the client's own, and they exist to keep distinct things
distinct:

- **`UPSTREAM_UNAVAILABLE`** (status 0) — no HTTP response at all. Never
  reported as a validation failure, so an unreachable API never blames what the
  user typed, and never reported as a missing record.
- **`MALFORMED_RESPONSE`** — a response that is not the documented envelope,
  including one missing an expected key. It is an error rather than an empty
  list, because rendering "no categories" for a response that simply was not
  what we expected hides a real breakage behind an empty state that looks
  deliberate.

Contract functions return `{ ok: true, data } | { ok: false, error }` rather
than throwing, so every call site has to decide what the failure means.

## 6. Refresh coordination, and its one limitation

`createRefreshCoordinator` (`src/lib/api/refresh.ts`) single-flights refreshes
so that concurrent requests presenting the same refresh token produce one
rotation. Without it, the second request would present a token the first had
already consumed, the backend would read that as replay, and the session would
be revoked — signing the user out for no reason.

The coordinator is created at **module scope** in `src/lib/api/session.ts`. That
is the point, not an accident: the duplicate requests arrive on *different*
requests, so a per-request coordinator would never see a duplicate and would
protect nothing.

**The limitation:** this is exact for a single long-lived instance and
best-effort across several. Two instances can each rotate the same token. It is
confined to one line — a deployment needing a shared lock swaps the coordinator
for one backed by Redis or the database and changes nothing else. Recorded here
so it is a known bound rather than a surprise.

`refreshSession` is the only path that rotates a token, and it distinguishes
three outcomes: `refreshed` stores the new pair; `session-over` clears the
cookies; `unavailable` clears **nothing**, because an API that is down is not
evidence that the session ended, and signing someone out over a network blip is
worse than the blip.

## 7. Client data fetching

Pages that fetch on mount follow one pattern, established in
`src/lib/auth/session-context.tsx` and used by `/onboarding` and
`/settings/profile`:

- The fetch lives at **module scope**, taking no arguments and closing over no
  state, so it is not recreated on every render and does not re-trigger its own
  effect.
- State is applied inside a `.then()` callback guarded by a `current` cleanup
  flag, not written directly in the effect body. This satisfies the
  `react-hooks/set-state-in-effect` rule, which is interprocedural — it follows
  into a function called from the effect even past an `await`. It is also
  strictly more correct: without the guard, a slow first attempt can clobber a
  fast retry.
- Retries bump an `attempt` counter, so repeated retries each take effect.
- Navigation after a successful submit is `router.push(...)` **with no
  `router.refresh()` alongside it.** Refresh re-renders the current route and
  clears its client cache, which supersedes the push while it is still an
  uncommitted transition — the navigation is then dropped. This was a real bug.

React's `StrictMode` double-invokes effects in development, so each fetch
appears twice on the network. That is expected, and it is why the harness's
checks assert on what the page ends up showing rather than on request counts.

## 8. Configuration

All configuration comes from environment variables. Nothing is hardcoded —
no secrets, tokens, passwords, private keys or production credentials.

- `API_BASE_URL` — the Go API origin. Server-only. Must match the backend's
  `ALLOWED_ORIGINS`.
- `.env.example` documents the variables and holds placeholders only.
- `.env.local` is gitignored and never committed.
- `src/lib/env.ts` validates public variables and fails fast with a message
  naming the variable, rather than letting an undefined value reach a request.

## 9. Testing strategy

**Unit and component tests** use Vitest with React Testing Library in jsdom,
under `__tests__/`, grouped by area. Conventions, all of which are deliberate:

- `fireEvent`, not `user-event`. No jest-dom matchers — assertions are on
  `element.textContent`. A small, fixed vocabulary beats a large one nobody
  reads.
- Server-only modules carry a `/** @vitest-environment node */` docblock.
- Route handlers are tested **as plain functions with real `Request` objects**,
  which is possible precisely because they take a request and return a response.
- Contract tests assert the exact URL, method and body sent upstream, so a
  changed field name is a failing test rather than a runtime surprise.

**Browser tests** are `scripts/verify-browser.mjs`, run with
`node scripts/verify-browser.mjs`. It launches a real Chrome over the DevTools
Protocol using Node's built-in `WebSocket` and `fetch` — no new dependency —
drives the real UI, and asserts against the real Go API.

This exists because **a green unit suite is not evidence that the app works.**
The failure modes it catches are the ones the unit suite structurally cannot:
a navigation that is issued and then dropped, a cookie that is set but not
`httpOnly`, two tabs racing on one refresh token, a form whose value is written
before React hydrates and therefore submits empty.

Two details worth knowing before editing it:

- Hydration is detected through the header's session controls, not
  `document.readyState` and not the presence of a form. Interacting with a
  server-rendered form before React attaches its listeners silently does
  nothing, and the page then reports a validation error that looks like an
  application bug.
- Turbopack compiles routes on demand, so the first request to a
  never-before-hit route can take longer than a short sampling window. The
  harness waits for a condition rather than sampling a fixed duration, for this
  reason.

The harness needs the Go API running and the Next dev server on `:3000`.

## 10. Known limitations

- **The proxy's check is optimistic.** A stale cookie lets a signed-out user
  see the protected shell briefly before the guard and the API refuse them. It
  is a flash, not an authorization hole.
- **Refresh coordination is per-instance**, as described in section 6.
- **The refresh cookie's lifetime is a mirror, not a reading.** The auth
  response carries `expires_in` for the access token and says nothing about the
  refresh token, so `REFRESH_COOKIE_MAX_AGE_SECONDS` mirrors the backend's
  default `REFRESH_TOKEN_TTL`. Being wrong is not a security problem — the
  backend is the authority on expiry and rejects a stale token whatever the
  browser thinks — but adding `refresh_expires_in` to the auth response would
  make it exact.
- **Onboarding completeness is inferred from registration**, not from the
  session. `/me/interests` returns an empty list for a user who has not chosen,
  which is a valid state the app cannot distinguish from "chose nothing".
  Registration is the one moment the app knows for certain that a user has
  never chosen, so that is where the prompt fires. Existing users are never
  nagged.
- **The interest ceiling's refusal path is unit-tested, not browser-reachable.**
  The picker refuses an 11th selection, but the seeded catalogue holds exactly
  ten categories, so there is no eleventh checkbox to click. The harness checks
  the reachable half — that all ten can be selected and saved — and says so in
  its own output.

## 11. Deployment assumptions

- One Node process serving both the app and the route handlers. The proxy layer
  and the refresh coordinator both assume a request reaches the same process
  that holds the session state.
- The Go API is reachable from the Node process over `API_BASE_URL`. The
  browser must be able to reach this app over HTTPS in production, because the
  `__Host-` cookie prefix requires Secure.

# Opueh web foundation

React with Vite and TypeScript, connected to the existing Go account API.

## What is implemented

- Responsive discovery page and navigation.
- Registration and login using the actual backend request and response shapes.
- In-memory access and refresh tokens with coordinated refresh on expiry.
- Protected account page, profile editing and selection of 1 to 10 interests.
- Password recovery, password reset, email verification and verification-link request.
- Loading, API validation, network failure and retry feedback.
- Sign out only after server revocation succeeds.

Reels, calls, messaging and live streaming are labelled upcoming. No fake users or media are included in the app.

## Local setup

Use Node.js 22.12+ or 24 LTS. Run these commands from `Opueh/web`:

```bash
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` requests to the Go server at http://localhost:8080. Change `API_PROXY_TARGET` in `web/.env` if the backend listens elsewhere. Do not put server secrets in variables beginning with `VITE_`; those variables are public.

In the backend `.env`, set:

```dotenv
APP_URL=http://localhost:5173
```

This makes password reset and verification email links open the new frontend. Start the backend with your existing DATABASE_URL, email and JWT configuration, then run `make run` from `Opueh`. The landing page can load without the API; account actions need a running backend and migrated database. Never overwrite an existing backend `.env` with the example without preserving its configuration.

## Session behaviour

Credentials exist only in memory. Reloading, opening another tab or closing the tab requires a new sign-in. This avoids persisting bearer credentials in localStorage. It does not protect credentials from script execution while the page is open. Before adding persistent browser sessions, implement Secure HttpOnly cookie refresh sessions or a backend-for-frontend, including CSRF and origin protections. Mobile JSON token flows can remain separate.

Recovery tokens are held in memory and removed from the address bar after opening. Reloading that cleaned page requires reopening the email link. Verification is submitted by an explicit button, not automatically on page load.

## Checks

```bash
npm run build
npm run lint
npm test
```

Unit tests cover error contracts, concurrent refresh, revoked sessions, forbidden responses, empty logout responses and logout during an in-flight refresh.

For real integration testing, use a staging account and two browser tabs. Verify registration, login, profile save, interest replacement, email links, invalid credentials, expired access token, revoked refresh token and server-side logout. Backend database tests require TEST_DATABASE_URL and Go installed.

## Production hosting

Build with `npm run build` and host the `dist` directory over HTTPS. Configure `/api/*` to forward to Go without changing the path. Serve `index.html` for non-API frontend routes, including `/reset-password` and `/verify-email`; never turn an API 404 into index.html. Vite's development proxy is not included in the production bundle. Set APP_URL to the public HTTPS origin. When using a separate API origin, set VITE_API_URL to its full `/api/v1` URL and explicitly allow the frontend origin in the backend CORS configuration.

Cache fingerprinted assets with immutable caching; revalidate index.html. Configure security headers at the host, including a tested Content Security Policy. Do not deploy the Vite development server for production.

## Next milestone

Implement the social graph and post APIs in Go, then integrate a real feed. Add follow, unfollow, post creation, paginated feeds and ownership enforcement before media uploads, reels or realtime messaging.

## Verification in this delivery environment

Frontend type checking, build, lint and API unit tests were executed. Browser checks use intercepted API fixtures and establish frontend behaviour only. No live Go/database integration result is claimed because Go and a configured database are unavailable here.

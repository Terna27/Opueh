# Frontend stabilization decision — 2026-10-13

## Approved direction
Next.js (App Router), TypeScript and Tailwind CSS are the canonical Opueh frontend. The existing Go API and PostgreSQL architecture remain authoritative.

## Repository reality
At the start of this audit, the remote main branch contains a React/Vite frontend under `web/`, but no `frontend/package.json` for the previously discussed Next.js application. The Vite implementation is a reference for existing user-facing behavior and API contracts, **not** the approved production frontend. Do not delete `web/` before equivalent behavior is verified in Next.js.

## Milestone S1 — Recover and reconcile
- [ ] Locate the previous Next.js working tree or committed branch; do not assume it exists remotely.
- [ ] Inventory all pages and workflows in `web/`: discovery, registration, login, profile, interests, recovery and email verification.
- [ ] Inventory actual Go route contracts, request/response schemas, error codes and security middleware.
- [ ] Restore the existing Next.js implementation if recoverable; otherwise scaffold it only after recording missing source and design requirements.
- [ ] Document a route-by-route migration checklist. Preserve the existing design rather than inventing a replacement.
- [ ] Run Next.js lint, typecheck, build and tests; record actual outputs.

## Milestone S2 — Authentication and session hardening
- [ ] Use Next.js server-side API/proxy handlers and HttpOnly cookies; no tokens in browser localStorage, sessionStorage, or client-side state.
- [ ] Verify access and rotating refresh token contracts against the Go backend.
- [ ] Implement single-flight refresh for one process, document multi-instance limitations and design distributed coordination before multi-instance deployment.
- [ ] Retry once after successful refresh; handle logout/revocation and failure without leaking credentials.
- [ ] Enforce appropriate Secure, SameSite and cookie Path attributes and CSRF/origin protections.
- [ ] Test registration, login, refresh, concurrent refresh, logout, invalid credentials and revoked sessions.

## Milestone S3 — Account integration
- [ ] Connect /me, profile updates, categories, interests, email verification and recovery using real Go APIs.
- [ ] Preserve backend validation messages and authorization rules.
- [ ] Verify loading, empty, failure, retry, responsive and accessibility states.

## Milestone S4 — Full verification
- [ ] Run Go fmt, vet, unit and PostgreSQL integration tests with test credentials.
- [ ] Verify migrations and deployment configuration; do not claim production readiness without real checks.
- [ ] Run browser-based end-to-end tests against a real Go/database environment.
- [ ] Update README, CI and architecture documentation to match the implementation.
- [ ] Open a PR from the audit branch and obtain review before merging.

## Working rules
Build → test → fix → retest → verify in the application → explain → stop for approval. No unverified completion claims. No direct pushes to main. No deletion of the legacy frontend until parity and team review are complete.

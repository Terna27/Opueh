# Architecture — Opueh Backend

This document records the architectural decisions for the Opueh social video
streaming platform backend. It is the reference every milestone builds on.
Changes to these decisions require updating this document first.

Last updated: Milestone 0.

## 1. Application shape: modular monolith

One Go binary, one deployable unit, one PostgreSQL database. Internal packages
enforce layer boundaries so that individual domains (websocket gateway, media
processing, analytics ingestion) can be extracted into services later without a
rewrite.

Deliberately NOT chosen: microservices from day one. The operational cost
(deployment, tracing, inter-service auth, distributed transactions) is not
justified at MVP scale, and the domain boundaries below keep the extraction
option open.

### Package layout

```
cmd/api/            composition root: main.go wires concrete implementations
internal/
  apperr/           centralized API error model (leaf, importable by all layers)
  config/           env loading + validation, loaded once at startup
  database/         pgxpool construction and DB lifecycle helpers
  handlers/         HTTP parsing, validation, service calls, serialization
  middleware/        request ID, logging, recovery, CORS, body limits, auth
  observability/    logger construction (later: metrics, tracing)
  repositories/     the only place SQL exists
  routes/           URL structure, middleware stack, handler registration
  services/         business logic and authorization policies
  storage/          object-storage abstraction (added in Milestone 8)
  websocket/        WS hub, rooms, Redis pub/sub (added in Milestone 14)
  streaming/        LiveKit integration (added in Milestone 18)
  notifications/    domain events -> notifications (added in Milestone 16)
  payments/         payment provider abstraction (added in Milestone 23)
  jobs/             background workers (added in Milestone 30)
  auth/             JWT issuing/verification, token rotation (Milestone 3)
  models/           domain structs shared across layers
migrations/         golang-migrate SQL files (up + down pairs)
docs/               architecture and, later, OpenAPI spec
tests/              cross-package integration / e2e tests
```

Packages are created when they become useful, not for appearance.

## 2. Dependency flow

```
cmd/api
  ↓
routes
  ↓
handlers        HTTP in/out only. No SQL. No business rules.
  ↓
services        business logic, authorization, transaction orchestration
  ↓
repositories    SQL lives here and only here
  ↓
database (pgxpool) → PostgreSQL
```

Rules:

- Dependencies point strictly downward. A repository never imports a service.
- Interfaces are defined where they are consumed (a service declares the
  repository interface it needs), which keeps tests fake-friendly and layers
  swappable.
- Handlers never see SQL. Services never import `net/http`.
- Identity, roles, ownership and permissions are always derived from
  authenticated server-side state, never from client-supplied payloads.

## 3. API design

- REST under a path-versioned prefix: `/api/v1/...`. A future `/api/v2` can
  coexist indefinitely; versions are cheap to route at CDN/ingress level.
- WebSockets carry realtime delivery only. Durable operations (creating a
  message, ending a stream) go through HTTP and the database first.
- `/health` (liveness) and `/ready` (readiness) are unversioned infrastructure
  probes.
- All list endpoints paginate. Feeds, messages, notifications and reels use
  cursor-based pagination (opaque, ordered cursors); admin/backoffice lists may
  use offset pagination.
- Request and response bodies are JSON with `Content-Type: application/json`.

## 4. Database strategy

- PostgreSQL is the single source of truth. Redis is a cache and coordination
  layer only (added later); nothing durable lives only in Redis.
- Driver: `pgx` v5 with `pgxpool`. No `database/sql` indirection.
- UUIDs (`gen_random_uuid()`) as primary keys for public-facing entities.
- All timestamps `timestamptz`, stored and interpreted as UTC.
- Integrity lives in the database: unique constraints, foreign keys, check
  constraints and indexes back every application-level validation.
- Transactions are owned by repositories/services, never handlers.
- Enum-like values use `CHECK` constraints on `text` columns (or Postgres
  enums where the value set is stable) so invalid states are unrepresentable.

## 5. Migration strategy

- Tool: `golang-migrate`, sequential versioning (`000001_name.up.sql` /
  `000001_name.down.sql`).
- Every migration has an up and a down.
- Migrations run as a distinct pre-deploy step (Makefile target now; a
  migration job in CI/CD later), never inside the API process.
- Staging and production apply migrations forward-only; down migrations exist
  for local development and disaster recovery.
- Schema changes never happen by hand against a real environment.

## 6. Configuration strategy

- Flat environment variables, loaded and validated once at startup in
  `internal/config`. The process exits on invalid or missing configuration —
  a half-configured server behind a load balancer is worse than no server.
- No config files, no config service, no runtime reload in the MVP.
- `.env` is gitignored and used for local development only.
  `.env.example` is committed and documents every variable.
- Secrets (DB URL, JWT keys, storage credentials, LiveKit secrets, payment
  keys) come exclusively from the environment / secret manager.
- Environments: LOCAL, STAGING, PRODUCTION, each with fully separate
  databases, Redis, storage, and credentials. Production credentials are never
  used locally.

## 7. Logging strategy

- stdlib `log/slog`, structured, one logger constructed at startup and
  injected via dependency injection — no package-level loggers.
- JSON output in staging/production; readable text in local.
- Request-scoped attributes (`request_id`, later `user_id`) are attached by
  middleware and flow through context.
- Never logged: passwords, access tokens, refresh tokens, verification/reset
  tokens, API secrets, payment secrets, full card data.
- Error paths log the underlying cause with full detail at the boundary where
  it is handled; clients only ever see the sanitized error model.

## 8. Error model

Every error response has the same shape:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

- `code`: stable, machine-readable, UPPER_SNAKE_CASE.
- `message`: safe for display to end users.
- Implemented once in `internal/apperr`. Unknown errors collapse to
  `INTERNAL` with a generic message; the real cause is logged, not returned.
- No stack traces, driver errors, or SQL text ever reach a client.

## 9. Authentication strategy (implemented in Milestone 3)

- Registration with password hashing (argon2id or bcrypt — decided at M3).
- Short-lived JWT access tokens (~15 minutes), verified statelessly.
- Opaque refresh tokens: random 256-bit values, stored hashed, rotated on
  every use, revocable per session. Replay of a rotated token revokes the
  family (stolen-token detection).
- Sessions are persisted server-side; logout revokes the session and all its
  refresh tokens.
- Authorization (roles, ownership, subscription entitlements) is always
  re-derived server-side from the token + database, centralized in
  services/policies — never trusted from request payloads.

## 10. Media strategy (implemented in Milestone 8+)

- The API owns metadata and authorization; bytes live in S3-compatible
  object storage.
- Uploads: the API issues short-lived pre-signed upload URLs; clients PUT
  directly to storage. Large videos never pass through Go handlers.
- Playback: pre-signed GET URLs / CDN URLs issued only after authorization.
- A `media_assets` table tracks the lifecycle:
  `PENDING → UPLOADING → PROCESSING → READY / FAILED → DELETED`.
- Transcoding is delegated to an external worker/service; the backend reacts
  to processing callbacks. The Go API is never a transcoding engine.

## 11. WebSocket strategy (implemented in Milestone 14+)

- Auth: client requests a short-lived, single-use WS ticket over
  authenticated HTTP, then connects with it. Long-lived tokens never appear in
  query strings.
- A connection manager per instance handles heartbeat, cleanup and reconnect.
- Redis pub/sub fans out messages across API instances so any instance can
  serve any user — horizontal scaling from day one.
- Realtime is delivery only; durability goes through HTTP + PostgreSQL.

## 12. Live streaming strategy (implemented in Milestone 17+)

- LiveKit as the SFU (WebRTC). The Go backend owns: room creation, scoped
  room tokens (publisher/subscriber grants), publishing/viewing permissions,
  subscription gating, stream lifecycle state machine
  (SCHEDULED/STARTING/LIVE/ENDED/FAILED/CANCELLED), webhooks, bans.
- Provider API secrets stay server-side; clients only ever receive scoped,
  expiring tokens.
- Live chat is part of the WS domain with per-room rate limiting and
  moderation powers.

## 13. Deployment assumptions

- Stateless API instances in containers behind a load balancer; autoscale on
  CPU/latency.
- Managed PostgreSQL with automated backups; managed Redis; S3-compatible
  storage fronted by a CDN; LiveKit (cloud or self-hosted SFU).
- Migrations run as a pre-deploy job.
- `/health` for liveness, `/ready` for readiness (checks PostgreSQL).
- Rolling deployments with the readiness gate; rollback = previous image +
  forward-fix migrations only.
- Observability: structured logs, request IDs, metrics and tracing added in
  Milestone 33 — the middleware and logger seams are designed for it now.

## 14. Testing strategy

- Unit tests for services and pure logic (fakes for repositories).
- Repository integration tests against a real PostgreSQL database
  (skipped when `TEST_DATABASE_URL` is unset).
- HTTP tests with `net/http/httptest` through the real router.
- WebSocket tests once the gateway exists.
- Load testing late, against realistic data volumes.

# Opueh Backend

Production-grade Go backend for the Opueh social video streaming platform.

Architecture decisions and conventions live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — read that first.

## Stack

- Go 1.22, `net/http` + [chi](https://github.com/go-chi/chi) router
- PostgreSQL via [pgx v5](https://github.com/jackc/pgx) (`pgxpool`)
- Migrations via [golang-migrate](https://github.com/golang-migrate/migrate)
- Structured logging with stdlib `log/slog`
- Redis, WebSockets, object storage and LiveKit arrive in later milestones

## Quick start (local)

Prerequisites: Go 1.22+, the `migrate` CLI, and PostgreSQL 14+ (native or Docker).

### Option A — Native PostgreSQL (recommended)

```bash
sudo apt update && sudo apt install -y postgresql
sudo systemctl enable --now postgresql

# Create the application role and database.
sudo -u postgres psql -c "CREATE ROLE opueh LOGIN PASSWORD 'opueh';"
sudo -u postgres psql -c "CREATE DATABASE opueh OWNER opueh;"

# Verify connectivity as the application user.
psql "postgres://opueh:opueh@localhost:5432/opueh?sslmode=disable" -c "SELECT version();"
```

### Option B — PostgreSQL via Docker

```bash
sudo docker compose up -d      # wait for `sudo docker compose ps` to show healthy
```

Do not run both at once — they both bind port 5432.

### Then

```bash
cp .env.example .env          # defaults already match the setup above
make migrate-up               # apply migrations
make run                      # start the API on :8080
```

Verify:

```bash
curl -i http://localhost:8080/health   # liveness -> 200 {"status":"ok"}
curl -i http://localhost:8080/ready    # readiness -> 200 {"status":"ready",...}
```

## Development commands

```bash
make fmt      # go fmt ./...
make test     # go test ./...
make vet      # go vet ./...
make build    # go build -o bin/api ./cmd/api
```

Repository integration tests run automatically when `TEST_DATABASE_URL` is
set; otherwise they are skipped.

## Migrations

```bash
make migrate-new name=add_users   # create migrations/NNNNNN_add_users.{up,down}.sql
make migrate-up                   # apply pending
make migrate-down                 # roll back the latest
```

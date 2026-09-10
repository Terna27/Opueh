MIGRATIONS_PATH ?= migrations

.PHONY: help run build test test-db fmt vet tidy \
	db-up db-down db-logs \
	migrate-up migrate-down migrate-force migrate-new \
	docker-build

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

run: ## Start the API server locally (exports .env if present)
	@if [ -f .env ]; then set -a; . ./.env; set +a; fi; go run ./cmd/api

build: ## Build the API binary into bin/
	go build -o bin/api ./cmd/api

test: ## Run all tests
	go test ./...

test-db: ## Run all tests including database integration tests (uses .env)
	@set -a; . ./.env; set +a; \
	TEST_DATABASE_URL="$$DATABASE_URL" go test ./...

fmt: ## Format all Go sources
	go fmt ./...

vet: ## Run go vet
	go vet ./...

tidy: ## Tidy go.mod / go.sum
	go mod tidy

db-up: ## Start the local PostgreSQL container
	docker compose up -d

db-down: ## Stop the local PostgreSQL container (data is kept)
	docker compose down

db-logs: ## Tail local PostgreSQL logs
	docker compose logs -f postgres

migrate-up: ## Apply all pending migrations
	@set -a; . ./.env; set +a; \
	migrate -path $(MIGRATIONS_PATH) -database "$$DATABASE_URL" up

migrate-down: ## Roll back one migration
	@set -a; . ./.env; set +a; \
	migrate -path $(MIGRATIONS_PATH) -database "$$DATABASE_URL" down 1

migrate-force: ## Force migration version: make migrate-force VERSION=N
	@set -a; . ./.env; set +a; \
	migrate -path $(MIGRATIONS_PATH) -database "$$DATABASE_URL" force $(VERSION)

docker-build: ## Build the production container image
	docker build -t opueh-api .

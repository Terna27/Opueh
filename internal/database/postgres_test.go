package database

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Tena-byte/opueh/internal/config"
)

// These tests require a real PostgreSQL instance. They are skipped unless
// TEST_DATABASE_URL is set, so `go test ./...` works without a database
// while CI can run the full suite:
//
//	TEST_DATABASE_URL=postgres://opueh:opueh@localhost:5432/opueh?sslmode=disable go test ./internal/database/...
func testConfig(t *testing.T) *config.Config {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping database integration test")
	}
	return &config.Config{
		DatabaseURL:    url,
		DBMaxConns:     2,
		DBMinConns:     1,
		DBConnLifetime: time.Minute,
		DBConnIdleTime: 30 * time.Second,
		DBHealthCheck:  30 * time.Second,
	}
}

func TestNewPool_ConnectsAndPings(t *testing.T) {
	cfg := testConfig(t)

	pool, err := NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewPool failed: %v", err)
	}
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping after pool creation failed: %v", err)
	}
}

func TestNewPool_RejectsInvalidURL(t *testing.T) {
	cfg := &config.Config{DatabaseURL: "not-a-postgres-url"}

	if _, err := NewPool(context.Background(), cfg); err == nil {
		t.Fatal("expected an error for an invalid DATABASE_URL")
	}
}

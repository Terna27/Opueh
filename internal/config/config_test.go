package config

import (
	"strings"
	"testing"
	"time"
)

const testJWTSecret = "test-secret-that-is-at-least-32-bytes-long!"

func TestLoad_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error when DATABASE_URL is missing")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Errorf("error should mention DATABASE_URL, got: %v", err)
	}
}

func TestLoad_InvalidEnvironment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("ENV", "dev")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error for an invalid ENV value")
	}
	if !strings.Contains(err.Error(), "ENV") {
		t.Errorf("error should mention ENV, got: %v", err)
	}
}

func TestLoad_InvalidLogLevel(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("LOG_LEVEL", "verbose")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error for an invalid LOG_LEVEL value")
	}
	if !strings.Contains(err.Error(), "LOG_LEVEL") {
		t.Errorf("error should mention LOG_LEVEL, got: %v", err)
	}
}

func TestLoad_MinConnsAboveMaxConns(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("DB_MAX_CONNS", "5")
	t.Setenv("DB_MIN_CONNS", "10")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error when DB_MIN_CONNS exceeds DB_MAX_CONNS")
	}
}

func TestLoad_MissingJWTSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error when JWT_SECRET is missing")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Errorf("error should mention JWT_SECRET, got: %v", err)
	}
}

func TestLoad_ShortJWTSecret(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", "too-short")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error for a JWT_SECRET shorter than 32 bytes")
	}
}

func TestLoad_RefreshTTLShorterThanAccessTTL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("ACCESS_TOKEN_TTL", "24h")
	t.Setenv("REFRESH_TOKEN_TTL", "1h")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error when REFRESH_TOKEN_TTL < ACCESS_TOKEN_TTL")
	}
}

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", testJWTSecret)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Environment != EnvLocal {
		t.Errorf("default environment = %q, want %q", cfg.Environment, EnvLocal)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("default addr = %q, want %q", cfg.HTTPAddr, ":8080")
	}
	if cfg.RequestBodyLimitBytes != 1<<20 {
		t.Errorf("default body limit = %d, want %d", cfg.RequestBodyLimitBytes, 1<<20)
	}
	if cfg.DBMaxConns != 10 {
		t.Errorf("default max conns = %d, want 10", cfg.DBMaxConns)
	}
	if cfg.ShutdownTimeout != 30*time.Second {
		t.Errorf("default shutdown timeout = %v, want 30s", cfg.ShutdownTimeout)
	}
	if !cfg.IsProduction() && cfg.Environment != EnvLocal {
		t.Errorf("unexpected environment %q", cfg.Environment)
	}
}

func TestLoad_Overrides(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@dbhost:5433/prod")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("ENV", "production")
	t.Setenv("HTTP_ADDR", ":9000")
	t.Setenv("DB_MAX_CONNS", "25")
	t.Setenv("ALLOWED_ORIGINS", "https://app.example.com, https://web.example.com")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !cfg.IsProduction() {
		t.Error("IsProduction should be true for ENV=production")
	}
	if cfg.HTTPAddr != ":9000" {
		t.Errorf("addr = %q, want :9000", cfg.HTTPAddr)
	}
	if cfg.DBMaxConns != 25 {
		t.Errorf("max conns = %d, want 25", cfg.DBMaxConns)
	}
	want := []string{"https://app.example.com", "https://web.example.com"}
	if len(cfg.AllowedOrigins) != len(want) {
		t.Fatalf("origins = %v, want %v", cfg.AllowedOrigins, want)
	}
	for i := range want {
		if cfg.AllowedOrigins[i] != want[i] {
			t.Errorf("origins[%d] = %q, want %q", i, cfg.AllowedOrigins[i], want[i])
		}
	}
}

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
	t.Setenv("ENV", "staging") // production refuses the dev email sender
	t.Setenv("HTTP_ADDR", ":9000")
	t.Setenv("DB_MAX_CONNS", "25")
	t.Setenv("ALLOWED_ORIGINS", "https://app.example.com, https://web.example.com")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.IsProduction() {
		t.Error("IsProduction should be false for ENV=staging")
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

func TestLoad_ProductionRefusesDevEmailSender(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@dbhost:5433/prod")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("ENV", "production")

	_, err := Load()
	if err == nil {
		t.Fatal("expected production to refuse the dev email sender")
	}
	if !strings.Contains(err.Error(), "EMAIL_PROVIDER") {
		t.Errorf("error should mention EMAIL_PROVIDER, got: %v", err)
	}
}

func TestLoad_StagingAllowsDevEmailSender(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://u:p@dbhost:5433/prod")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("ENV", "staging")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("staging should accept the dev email sender: %v", err)
	}
	if cfg.EmailProvider != "dev" {
		t.Errorf("email provider = %q, want dev", cfg.EmailProvider)
	}
}

func TestLoad_InvalidAppURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("APP_URL", "not-a-url")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error for a non-http APP_URL")
	}
	if !strings.Contains(err.Error(), "APP_URL") {
		t.Errorf("error should mention APP_URL, got: %v", err)
	}
}

func TestLoad_AccountDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", testJWTSecret)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.AppURL != "http://localhost:3000" {
		t.Errorf("default APP_URL = %q", cfg.AppURL)
	}
	if cfg.EmailProvider != "dev" {
		t.Errorf("default EMAIL_PROVIDER = %q, want dev", cfg.EmailProvider)
	}
	if cfg.EmailVerificationTokenTTL != 24*time.Hour {
		t.Errorf("default verification TTL = %v, want 24h", cfg.EmailVerificationTokenTTL)
	}
	if cfg.PasswordResetTokenTTL != time.Hour {
		t.Errorf("default reset TTL = %v, want 1h", cfg.PasswordResetTokenTTL)
	}
	if cfg.EmailResendCooldown != time.Minute || cfg.PasswordResetCooldown != time.Minute {
		t.Errorf("default cooldowns = %v/%v, want 1m/1m", cfg.EmailResendCooldown, cfg.PasswordResetCooldown)
	}
	if cfg.PasswordForgotIPLimit != 10 || cfg.PasswordForgotIPRateWindow != time.Hour {
		t.Errorf("default IP limit = %d per %v, want 10 per 1h", cfg.PasswordForgotIPLimit, cfg.PasswordForgotIPRateWindow)
	}

	if cfg.AuthBodyLimitBytes != 4096 {
		t.Errorf("default auth body limit = %d, want 4096", cfg.AuthBodyLimitBytes)
	}
	if cfg.LoginRateLimit != 10 || cfg.LoginRateWindow != time.Minute {
		t.Errorf("default login rate = %d per %v, want 10 per 1m", cfg.LoginRateLimit, cfg.LoginRateWindow)
	}
	if cfg.LoginMaxFailures != 5 || cfg.LoginFailureWindow != 15*time.Minute || cfg.LoginLockoutDuration != 15*time.Minute {
		t.Errorf("default lockout = %d failures per %v, locked %v; want 5 per 15m, locked 15m",
			cfg.LoginMaxFailures, cfg.LoginFailureWindow, cfg.LoginLockoutDuration)
	}
}

func TestLoad_AuthBodyLimitAboveGlobalRejected(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("AUTH_BODY_LIMIT_BYTES", "999999999")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error when AUTH_BODY_LIMIT_BYTES exceeds the global limit")
	}
	if !strings.Contains(err.Error(), "AUTH_BODY_LIMIT_BYTES") {
		t.Errorf("error should mention AUTH_BODY_LIMIT_BYTES, got: %v", err)
	}
}

func TestLoad_InvalidLoginProtectionSettings(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/db")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("LOGIN_RATE_LIMIT", "0")

	_, err := Load()
	if err == nil {
		t.Fatal("expected an error for LOGIN_RATE_LIMIT < 1")
	}
	if !strings.Contains(err.Error(), "LOGIN_RATE_LIMIT") {
		t.Errorf("error should mention LOGIN_RATE_LIMIT, got: %v", err)
	}
}

// productionBase is a fully valid production configuration; the individual
// refusal tests break exactly one setting on top of it.
func productionBase(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://u:p@dbhost:5433/prod")
	t.Setenv("JWT_SECRET", testJWTSecret)
	t.Setenv("ENV", "production")
	t.Setenv("APP_URL", "https://app.example.com")
	t.Setenv("EMAIL_PROVIDER", "ses") // a real (future) provider — not the dev logger
}

func TestLoad_ProductionRefusesLongAccessTokenTTL(t *testing.T) {
	productionBase(t)
	t.Setenv("ACCESS_TOKEN_TTL", "24h")

	_, err := Load()
	if err == nil {
		t.Fatal("expected production to refuse ACCESS_TOKEN_TTL > 1h")
	}
	if !strings.Contains(err.Error(), "ACCESS_TOKEN_TTL") {
		t.Errorf("error should mention ACCESS_TOKEN_TTL, got: %v", err)
	}
}

func TestLoad_ProductionRefusesLongRefreshTokenTTL(t *testing.T) {
	productionBase(t)
	t.Setenv("REFRESH_TOKEN_TTL", "8760h")

	_, err := Load()
	if err == nil {
		t.Fatal("expected production to refuse REFRESH_TOKEN_TTL > 90 days")
	}
	if !strings.Contains(err.Error(), "REFRESH_TOKEN_TTL") {
		t.Errorf("error should mention REFRESH_TOKEN_TTL, got: %v", err)
	}
}

func TestLoad_ProductionRequiresHTTPSAppURL(t *testing.T) {
	productionBase(t)
	t.Setenv("APP_URL", "http://app.example.com")

	_, err := Load()
	if err == nil {
		t.Fatal("expected production to refuse a non-https APP_URL")
	}
	if !strings.Contains(err.Error(), "APP_URL") {
		t.Errorf("error should mention APP_URL, got: %v", err)
	}
}

func TestLoad_ProductionRefusesPlaceholderJWTSecret(t *testing.T) {
	productionBase(t)
	t.Setenv("JWT_SECRET", "replace-me-with-a-random-48-byte-base64-string")

	_, err := Load()
	if err == nil {
		t.Fatal("expected production to refuse the .env.example placeholder JWT_SECRET")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Errorf("error should mention JWT_SECRET, got: %v", err)
	}
}

func TestLoad_ProductionAcceptsSecureSettings(t *testing.T) {
	productionBase(t) // only the email provider is unimplemented and refused

	// EMAIL_PROVIDER=ses is not wired yet, so production still refuses to
	// start today — but NOT for any of the M5 security rules: the error
	// must not mention TTLs, APP_URL or JWT_SECRET.
	_, err := Load()
	if err == nil {
		return // a real provider got wired; nothing to assert
	}
	for _, setting := range []string{"ACCESS_TOKEN_TTL", "REFRESH_TOKEN_TTL", "APP_URL must use https", "JWT_SECRET is still"} {
		if strings.Contains(err.Error(), setting) {
			t.Errorf("secure production config rejected over %q: %v", setting, err)
		}
	}
}

// Package config loads and validates all application configuration from
// environment variables. It is loaded exactly once at startup; the process
// refuses to start when configuration is invalid (fail fast).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment identifies the deployment environment.
type Environment string

const (
	EnvLocal      Environment = "local"
	EnvStaging    Environment = "staging"
	EnvProduction Environment = "production"
)

// Config holds every setting the application needs. All fields are populated
// from environment variables with safe defaults for local development.
type Config struct {
	ServiceName string
	Environment Environment
	LogLevel    string

	HTTPAddr string

	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ShutdownTimeout   time.Duration

	// RequestBodyLimitBytes caps request body sizes accepted by the API.
	RequestBodyLimitBytes int64
	// AuthBodyLimitBytes is the tighter cap applied to /auth endpoints.
	AuthBodyLimitBytes int64

	DatabaseURL     string
	DBMaxConns      int32
	DBMinConns      int32
	DBConnLifetime  time.Duration
	DBConnIdleTime  time.Duration
	DBHealthCheck   time.Duration
	ReadyCheckDelay time.Duration

	AllowedOrigins []string

	// Authentication.
	JWTSecret       string        // signing key for access tokens (>= 32 bytes)
	JWTIssuer       string        // iss claim
	AccessTokenTTL  time.Duration // short-lived JWT lifetime
	RefreshTokenTTL time.Duration // rotating refresh token lifetime
	SessionTTL      time.Duration // session lifetime (bounds the token family)

	// Email verification & password recovery.
	AppURL                     string        // public frontend base URL used in email links
	EmailProvider              string        // email delivery backend ("dev"; more later)
	EmailVerificationTokenTTL  time.Duration // verification link lifetime
	PasswordResetTokenTTL      time.Duration // reset link lifetime
	EmailResendCooldown        time.Duration // min time between verification emails per user
	PasswordResetCooldown      time.Duration // min time between reset emails per user
	PasswordForgotIPLimit      int           // forgotten-password requests per IP per window
	PasswordForgotIPRateWindow time.Duration // window for the per-IP forgotten-password limit

	// Login brute-force protection.
	LoginRateLimit       int           // login attempts per window per key (IP and identifier)
	LoginRateWindow      time.Duration // window for the login rate limits
	LoginMaxFailures     int           // failures (per identifier) that trigger lockout
	LoginFailureWindow   time.Duration // window failures are counted within
	LoginLockoutDuration time.Duration // how long the lockout lasts
}

// Load reads configuration from the environment and validates it.
func Load() (*Config, error) {
	cfg := &Config{
		ServiceName: getEnv("SERVICE_NAME", "opueh-api"),
		Environment: Environment(getEnv("ENV", string(EnvLocal))),
		LogLevel:    getEnv("LOG_LEVEL", "info"),

		HTTPAddr: getEnv("HTTP_ADDR", ":8080"),

		ReadHeaderTimeout: getEnvDuration("HTTP_READ_HEADER_TIMEOUT", 5*time.Second),
		ReadTimeout:       getEnvDuration("HTTP_READ_TIMEOUT", 10*time.Second),
		WriteTimeout:      getEnvDuration("HTTP_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:       getEnvDuration("HTTP_IDLE_TIMEOUT", 120*time.Second),
		ShutdownTimeout:   getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),

		RequestBodyLimitBytes: getEnvInt64("REQUEST_BODY_LIMIT_BYTES", 1<<20), // 1 MiB
		AuthBodyLimitBytes:    getEnvInt64("AUTH_BODY_LIMIT_BYTES", 4096),     // 4 KiB — auth payloads are tiny

		DatabaseURL:     os.Getenv("DATABASE_URL"),
		DBMaxConns:      int32(getEnvInt("DB_MAX_CONNS", 10)),
		DBMinConns:      int32(getEnvInt("DB_MIN_CONNS", 2)),
		DBConnLifetime:  getEnvDuration("DB_MAX_CONN_LIFETIME", 30*time.Minute),
		DBConnIdleTime:  getEnvDuration("DB_MAX_CONN_IDLE_TIME", 5*time.Minute),
		DBHealthCheck:   getEnvDuration("DB_HEALTH_CHECK_PERIOD", time.Minute),
		ReadyCheckDelay: getEnvDuration("READY_CHECK_TIMEOUT", 2*time.Second),

		AllowedOrigins: getEnvSlice("ALLOWED_ORIGINS", []string{"http://localhost:3000"}),

		JWTSecret:       os.Getenv("JWT_SECRET"),
		JWTIssuer:       getEnv("JWT_ISSUER", "opueh"),
		AccessTokenTTL:  getEnvDuration("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL: getEnvDuration("REFRESH_TOKEN_TTL", 720*time.Hour),
		SessionTTL:      getEnvDuration("SESSION_TTL", 720*time.Hour),

		AppURL:                     getEnv("APP_URL", "http://localhost:3000"),
		EmailProvider:              getEnv("EMAIL_PROVIDER", "dev"),
		EmailVerificationTokenTTL:  getEnvDuration("EMAIL_VERIFICATION_TOKEN_TTL", 24*time.Hour),
		PasswordResetTokenTTL:      getEnvDuration("PASSWORD_RESET_TOKEN_TTL", time.Hour),
		EmailResendCooldown:        getEnvDuration("EMAIL_RESEND_COOLDOWN", time.Minute),
		PasswordResetCooldown:      getEnvDuration("PASSWORD_RESET_COOLDOWN", time.Minute),
		PasswordForgotIPLimit:      getEnvInt("PASSWORD_FORGOT_IP_LIMIT", 10),
		PasswordForgotIPRateWindow: getEnvDuration("PASSWORD_FORGOT_IP_WINDOW", time.Hour),

		LoginRateLimit:       getEnvInt("LOGIN_RATE_LIMIT", 10),
		LoginRateWindow:      getEnvDuration("LOGIN_RATE_WINDOW", time.Minute),
		LoginMaxFailures:     getEnvInt("LOGIN_MAX_FAILURES", 5),
		LoginFailureWindow:   getEnvDuration("LOGIN_FAILURE_WINDOW", 15*time.Minute),
		LoginLockoutDuration: getEnvDuration("LOGIN_LOCKOUT_DURATION", 15*time.Minute),
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	var problems []string

	switch c.Environment {
	case EnvLocal, EnvStaging, EnvProduction:
	default:
		problems = append(problems, fmt.Sprintf("ENV must be one of %s|%s|%s (got %q)", EnvLocal, EnvStaging, EnvProduction, c.Environment))
	}

	switch strings.ToLower(c.LogLevel) {
	case "debug", "info", "warn", "error":
	default:
		problems = append(problems, fmt.Sprintf("LOG_LEVEL must be debug|info|warn|error (got %q)", c.LogLevel))
	}

	if c.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}

	if c.DBMaxConns < 1 {
		problems = append(problems, "DB_MAX_CONNS must be >= 1")
	}
	if c.DBMinConns < 0 {
		problems = append(problems, "DB_MIN_CONNS must be >= 0")
	}
	if c.DBMinConns > c.DBMaxConns {
		problems = append(problems, "DB_MIN_CONNS must be <= DB_MAX_CONNS")
	}

	if c.RequestBodyLimitBytes < 1 {
		problems = append(problems, "REQUEST_BODY_LIMIT_BYTES must be >= 1")
	}
	if c.AuthBodyLimitBytes < 1 {
		problems = append(problems, "AUTH_BODY_LIMIT_BYTES must be >= 1")
	}
	if c.AuthBodyLimitBytes > c.RequestBodyLimitBytes {
		problems = append(problems, "AUTH_BODY_LIMIT_BYTES must be <= REQUEST_BODY_LIMIT_BYTES (it can only narrow the global limit)")
	}

	if c.ReadHeaderTimeout <= 0 || c.ReadTimeout <= 0 || c.WriteTimeout <= 0 || c.IdleTimeout <= 0 {
		problems = append(problems, "HTTP timeouts must all be positive")
	}
	if c.ShutdownTimeout <= 0 {
		problems = append(problems, "SHUTDOWN_TIMEOUT must be positive")
	}
	if c.ReadyCheckDelay <= 0 {
		problems = append(problems, "READY_CHECK_TIMEOUT must be positive")
	}

	// Authentication.
	if len(c.JWTSecret) < 32 {
		problems = append(problems, "JWT_SECRET is required and must be at least 32 bytes (generate one with: openssl rand -base64 48)")
	}
	if c.AccessTokenTTL <= 0 || c.RefreshTokenTTL <= 0 || c.SessionTTL <= 0 {
		problems = append(problems, "ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL and SESSION_TTL must all be positive")
	}
	if c.RefreshTokenTTL < c.AccessTokenTTL {
		problems = append(problems, "REFRESH_TOKEN_TTL must be >= ACCESS_TOKEN_TTL")
	}

	// Email verification & password recovery.
	if !strings.HasPrefix(c.AppURL, "http://") && !strings.HasPrefix(c.AppURL, "https://") {
		problems = append(problems, "APP_URL must start with http:// or https://")
	}
	switch strings.ToLower(c.EmailProvider) {
	case "dev":
		// The dev sender logs emails (including secret links) instead of
		// delivering them. Local and staging are team-controlled
		// environments; production must have a real provider wired so
		// email is never silently swallowed.
		if c.Environment == EnvProduction {
			problems = append(problems, "EMAIL_PROVIDER=dev is not allowed when ENV=production; configure a real email provider")
		}
	default:
		problems = append(problems, `EMAIL_PROVIDER must be "dev" (a real provider is not wired yet)`)
	}
	if c.EmailVerificationTokenTTL <= 0 || c.PasswordResetTokenTTL <= 0 {
		problems = append(problems, "EMAIL_VERIFICATION_TOKEN_TTL and PASSWORD_RESET_TOKEN_TTL must be positive")
	}
	if c.EmailResendCooldown < 0 || c.PasswordResetCooldown < 0 {
		problems = append(problems, "EMAIL_RESEND_COOLDOWN and PASSWORD_RESET_COOLDOWN must not be negative")
	}
	if c.PasswordForgotIPLimit < 1 || c.PasswordForgotIPRateWindow <= 0 {
		problems = append(problems, "PASSWORD_FORGOT_IP_LIMIT must be >= 1 and PASSWORD_FORGOT_IP_WINDOW must be positive")
	}

	// Login brute-force protection.
	if c.LoginRateLimit < 1 || c.LoginRateWindow <= 0 {
		problems = append(problems, "LOGIN_RATE_LIMIT must be >= 1 and LOGIN_RATE_WINDOW must be positive")
	}
	if c.LoginMaxFailures < 1 || c.LoginFailureWindow <= 0 || c.LoginLockoutDuration <= 0 {
		problems = append(problems, "LOGIN_MAX_FAILURES must be >= 1 and LOGIN_FAILURE_WINDOW and LOGIN_LOCKOUT_DURATION must be positive")
	}

	// Production refuses insecure settings: the process must not start with
	// token lifetimes beyond safe bounds, non-TTLS public URLs, or the
	// .env.example placeholder secret.
	if c.Environment == EnvProduction {
		if c.AccessTokenTTL > time.Hour {
			problems = append(problems, "ACCESS_TOKEN_TTL must be <= 1h in production")
		}
		if c.RefreshTokenTTL > 90*24*time.Hour {
			problems = append(problems, "REFRESH_TOKEN_TTL must be <= 2160h (90 days) in production")
		}
		if !strings.HasPrefix(c.AppURL, "https://") {
			problems = append(problems, "APP_URL must use https:// in production")
		}
		if c.JWTSecret == "replace-me-with-a-random-48-byte-base64-string" {
			problems = append(problems, "JWT_SECRET is still the .env.example placeholder; set a real secret (openssl rand -base64 48)")
		}
	}

	if len(problems) > 0 {
		return fmt.Errorf("invalid configuration:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return nil
}

// IsProduction reports whether the process runs in the production environment.
func (c *Config) IsProduction() bool {
	return c.Environment == EnvProduction
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func getEnvSlice(key string, fallback []string) []string {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}

func getEnvInt(key string, fallback int) int {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return n
}

func getEnvInt64(key string, fallback int64) int64 {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil {
		return fallback
	}
	return n
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback
	}
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return d
}

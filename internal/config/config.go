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

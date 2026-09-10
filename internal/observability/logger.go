// Package observability owns construction of the application's logging and,
// in later milestones, metrics and tracing primitives.
package observability

import (
	"log/slog"
	"os"
	"strings"

	"github.com/Tena-byte/opueh/internal/config"
)

// NewLogger builds the process-wide structured logger.
//
// Production and staging emit JSON for machine ingestion; local development
// uses a human-readable text format. The service name and environment are
// attached to every record so log entries are attributable after aggregation.
func NewLogger(cfg *config.Config) *slog.Logger {
	level := parseLevel(cfg.LogLevel)

	opts := &slog.HandlerOptions{Level: level}

	var handler slog.Handler
	if cfg.IsProduction() || cfg.Environment == config.EnvStaging {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return slog.New(handler).With(
		"service", cfg.ServiceName,
		"env", string(cfg.Environment),
	)
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

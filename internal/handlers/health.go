// Package handlers contains HTTP handlers. Handlers are responsible only for
// parsing requests, validating input, calling services and serializing
// responses; business logic lives in services.
package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
)

// Pinger is the dependency the readiness probe needs: something that can
// verify its own health. *pgxpool.Pool satisfies it, and tests can use a
// fake.
type Pinger interface {
	Ping(ctx context.Context) error
}

// HealthHandler serves the liveness and readiness probes.
type HealthHandler struct {
	db           Pinger
	logger       *slog.Logger
	checkTimeout time.Duration
}

// NewHealthHandler constructs the health handler.
func NewHealthHandler(db Pinger, logger *slog.Logger, checkTimeout time.Duration) *HealthHandler {
	return &HealthHandler{db: db, logger: logger, checkTimeout: checkTimeout}
}

// Health reports whether the process is alive. It intentionally checks
// nothing else — a liveness probe that fails because a dependency is down
// causes the orchestrator to restart healthy instances.
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

// Ready reports whether the service can serve traffic, which requires its
// critical dependency (PostgreSQL) to be reachable. Failure returns 503 so
// load balancers and orchestrators pull the instance from rotation.
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.checkTimeout)
	defer cancel()

	if err := h.db.Ping(ctx); err != nil {
		h.logger.Error("readiness_check_failed",
			"request_id", middleware.RequestIDFromContext(r.Context()),
			"error", err.Error(),
		)
		apperr.WriteError(w, r, apperr.New(
			http.StatusServiceUnavailable,
			"NOT_READY",
			"Service dependencies are unavailable",
		))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ready",
		"checks": map[string]string{
			"postgres": "ok",
		},
	})
}

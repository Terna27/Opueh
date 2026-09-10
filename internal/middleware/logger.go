package middleware

import (
	"log/slog"
	"net/http"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// Logger emits exactly one structured log line per request after it
// completes, including the request ID, method, path, status code, duration
// and response size. 5xx responses are logged at error level so they stand
// out in aggregated logs and alerting.
//
// chimw.NewWrapResponseWriter is used instead of a bare wrapper so that
// underlying interfaces needed by later milestones (http.Flusher for
// streaming, http.Hijacker for WebSockets) keep working through the wrapper.
func Logger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

			defer func() {
				status := ww.Status()
				level := slog.LevelInfo
				if status >= http.StatusInternalServerError {
					level = slog.LevelError
				}

				logger.Log(r.Context(), level, "http_request",
					"request_id", RequestIDFromContext(r.Context()),
					"method", r.Method,
					"path", r.URL.Path,
					"status", status,
					"duration_ms", float64(time.Since(start).Microseconds())/1000.0,
					"bytes", ww.BytesWritten(),
					"remote", r.RemoteAddr,
				)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

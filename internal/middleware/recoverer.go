package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/Tena-byte/opueh/internal/apperr"
)

// Recoverer converts panics in downstream handlers into a 500 response in
// the standard error shape. The panic value and stack trace are logged with
// the request ID; neither is ever sent to the client.
func Recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					// http.ErrAbortHandler is the sentinel used by net/http
					// machinery (e.g. hijacked connections) and must be
					// re-thrown, not swallowed.
					if rec == http.ErrAbortHandler {
						panic(rec)
					}

					logger.Error("panic_recovered",
						"request_id", RequestIDFromContext(r.Context()),
						"method", r.Method,
						"path", r.URL.Path,
						"panic", rec,
						"stack", string(debug.Stack()),
					)

					apperr.WriteError(w, r, apperr.Internal("An unexpected error occurred"))
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}

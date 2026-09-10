package middleware

import (
	"net/http"
	"strings"
)

const (
	allowMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
	allowHeaders = "Content-Type, Authorization, X-Request-Id"
	maxAge       = "300" // 5 minutes; matches common preflight cache windows
)

// CORS enforces a strict origin allowlist. Origins are configured per
// environment; there is no wildcard-with-credentials mode. Preflight OPTIONS
// requests are answered directly; all other requests pass through with the
// appropriate Access-Control headers set when the origin is allowed.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowAll := false
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		if o == "*" {
			allowAll = true
			continue
		}
		allowed[strings.ToLower(o)] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				switch {
				case allowAll:
					w.Header().Set("Access-Control-Allow-Origin", "*")
				default:
					if _, ok := allowed[strings.ToLower(origin)]; ok {
						w.Header().Set("Access-Control-Allow-Origin", origin)
						w.Header().Set("Access-Control-Allow-Credentials", "true")
					}
				}
				// Vary tells caches the response depends on the Origin header.
				w.Header().Add("Vary", "Origin")
			}

			// Preflight request.
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				w.Header().Set("Access-Control-Allow-Methods", allowMethods)
				w.Header().Set("Access-Control-Allow-Headers", allowHeaders)
				w.Header().Set("Access-Control-Max-Age", maxAge)
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

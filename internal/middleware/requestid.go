// Package middleware contains HTTP middleware shared across all routes.
// All middleware is written against net/http types so it stays portable
// and testable independent of the router.
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

// RequestIDHeader is the header used to propagate request identifiers
// between clients, the load balancer and the service.
const RequestIDHeader = "X-Request-Id"

type contextKey string

const requestIDKey contextKey = "request_id"

// maxRequestIDLen bounds client-supplied request IDs to keep log lines and
// headers sane.
const maxRequestIDLen = 64

// RequestID assigns a unique identifier to every request. An incoming
// X-Request-Id header is honored (allowing tracing across the load balancer
// and upstream services) after sanitization; otherwise a random ID is
// generated. The ID is exposed on the response and via RequestIDFromContext.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := sanitizeRequestID(r.Header.Get(RequestIDHeader))
		if requestID == "" {
			requestID = newRequestID()
		}

		w.Header().Set(RequestIDHeader, requestID)
		ctx := context.WithValue(r.Context(), requestIDKey, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext returns the request ID assigned by the RequestID
// middleware, or an empty string if none is present.
func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

// newRequestID returns a random 128-bit hex-encoded identifier.
func newRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand never fails on supported platforms; fall back to a
		// constant rather than panicking inside middleware.
		return "00000000000000000000000000000000"
	}
	return hex.EncodeToString(b)
}

// sanitizeRequestID accepts only safe, bounded identifiers so a malicious
// client cannot inject log fields or header values.
func sanitizeRequestID(v string) string {
	if len(v) == 0 || len(v) > maxRequestIDLen {
		return ""
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '-', c == '_', c == '.', c == ':':
		default:
			return ""
		}
	}
	return v
}

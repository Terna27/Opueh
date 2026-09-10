package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestID_GeneratesWhenAbsent(t *testing.T) {
	var captured string

	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = RequestIDFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if captured == "" {
		t.Error("expected a request ID in context")
	}
	if got := rec.Header().Get(RequestIDHeader); got != captured {
		t.Errorf("response header = %q, want %q", got, captured)
	}
	if len(captured) != 32 {
		t.Errorf("generated ID length = %d, want 32 hex chars", len(captured))
	}
}

func TestRequestID_HonorsIncomingHeader(t *testing.T) {
	incoming := "req-abc-123"

	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := RequestIDFromContext(r.Context()); got != incoming {
			t.Errorf("context ID = %q, want %q", got, incoming)
		}
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(RequestIDHeader, incoming)
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get(RequestIDHeader); got != incoming {
		t.Errorf("response header = %q, want %q", got, incoming)
	}
}

func TestRequestID_ReplacesUnsafeIncomingHeader(t *testing.T) {
	tests := []string{
		"",                        // empty
		"bad id with spaces",      // spaces
		"bad\nid",                 // control characters (header injection)
		string(make([]byte, 65)),  // too long (all zeros, also invalid chars)
		"select * from users; --", // SQL-ish payload
	}
	for _, incoming := range tests {
		var captured string
		handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			captured = RequestIDFromContext(r.Context())
		}))

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set(RequestIDHeader, incoming)
		handler.ServeHTTP(httptest.NewRecorder(), req)

		if captured == "" {
			t.Fatal("expected a generated request ID")
		}
		if captured == incoming {
			t.Errorf("unsafe request ID %q was passed through", incoming)
		}
		if len(captured) != 32 {
			t.Errorf("generated ID length = %d, want 32", len(captured))
		}
	}
}

func TestRequestIDFromContext_EmptyWhenMissing(t *testing.T) {
	if got := RequestIDFromContext(context.Background()); got != "" {
		t.Errorf("expected empty request ID, got %q", got)
	}
}

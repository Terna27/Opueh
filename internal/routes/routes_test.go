package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/observability"
)

// newTestRouter builds the full application router without a database. The
// readiness endpoint is not exercised here: it is covered in the handlers
// package with a Pinger fake and in the database package against real
// PostgreSQL via TEST_DATABASE_URL.
func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	cfg := &config.Config{
		ServiceName:           "opueh-api-test",
		Environment:           config.EnvLocal,
		LogLevel:              "info",
		RequestBodyLimitBytes: 1 << 20,
		AllowedOrigins:        []string{"http://localhost:3000"},
		ReadyCheckDelay:       100 * time.Millisecond,
	}
	logger := observability.NewLogger(cfg)
	return NewRouter(Deps{Config: cfg, Logger: logger, DB: nil})
}

func TestRouter_HealthEndpoint(t *testing.T) {
	router := newTestRouter(t)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status field = %q, want ok", body["status"])
	}
}

func TestRouter_RequestIDHeaderOnEveryResponse(t *testing.T) {
	router := newTestRouter(t)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if got := rec.Header().Get("X-Request-Id"); len(got) != 32 {
		t.Errorf("X-Request-Id = %q, want a 32-char generated ID", got)
	}
}

func TestRouter_NotFoundUsesErrorModel(t *testing.T) {
	router := newTestRouter(t)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/nope", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), `"code":"NOT_FOUND"`) {
		t.Errorf("expected NOT_FOUND error body, got %s", rec.Body.String())
	}
}

func TestRouter_MethodNotAllowedUsesErrorModel(t *testing.T) {
	router := newTestRouter(t)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
	if !strings.Contains(rec.Body.String(), `"code":"METHOD_NOT_ALLOWED"`) {
		t.Errorf("expected METHOD_NOT_ALLOWED error body, got %s", rec.Body.String())
	}
}

func TestRouter_OversizedBodyRejected(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/anything", strings.NewReader("x"))
	req.ContentLength = 10 << 20 // exceeds the 1 MiB limit
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestRouter_CORSHeaders(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("allow-origin = %q, want http://localhost:3000", got)
	}
}

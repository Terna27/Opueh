package middleware

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders_AlwaysPresent(t *testing.T) {
	for _, production := range []bool{false, true} {
		handler := SecurityHeaders(production)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

		for header, want := range map[string]string{
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options":        "DENY",
			"Referrer-Policy":        "no-referrer",
			"X-XSS-Protection":       "0",
		} {
			if got := rec.Header().Get(header); got != want {
				t.Errorf("production=%v: %s = %q, want %q", production, header, got, want)
			}
		}
	}
}

func TestSecurityHeaders_HSTSOnlyInProduction(t *testing.T) {
	nonProd := SecurityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec := httptest.NewRecorder()
	nonProd.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := rec.Header().Get("Strict-Transport-Security"); got != "" {
		t.Errorf("HSTS set outside production: %q", got)
	}

	prod := SecurityHeaders(true)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec = httptest.NewRecorder()
	prod.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	want := "max-age=31536000; includeSubDomains"
	if got := rec.Header().Get("Strict-Transport-Security"); got != want {
		t.Errorf("HSTS = %q, want %q", got, want)
	}
}

func TestSecurityHeaders_PassesThroughAndPreservesHandlerHeaders(t *testing.T) {
	handler := SecurityHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "overridden") // Set, not Add — handler wins
		w.WriteHeader(http.StatusTeapot)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
	// The middleware sets headers before the handler runs; the handler can
	// still override them for specific responses if it ever needs to.
	if got := rec.Header().Get("X-Content-Type-Options"); got != "overridden" {
		t.Errorf("handler could not override middleware header: %q", got)
	}
}

// TestLogger_NeverLogsSecrets is the log-redaction guarantee for M5: a
// request carrying credentials (Authorization header, a password in the
// body, a refresh token in the body) must produce a log line containing
// none of them. The logger only records method/path/status/etc., so this
// test fails if anyone ever adds raw headers or bodies to it.
func TestLogger_NeverLogsSecrets(t *testing.T) {
	var buf strings.Builder
	logger := slog.New(slog.NewTextHandler(&buf, nil))

	handler := Logger(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	accessToken := "eyJhbGciOiJIUzI1NiJ9.secret-token-part.signature"
	body := `{"identifier":"jane@example.com","password":"super-secret-password-123","refresh_token":"rt_raw-refresh-token"}`

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "192.0.2.10:12345"

	handler.ServeHTTP(httptest.NewRecorder(), req)

	logged := buf.String()
	for _, secret := range []string{accessToken, "super-secret-password-123", "rt_raw-refresh-token", "Authorization"} {
		if strings.Contains(logged, secret) {
			t.Errorf("log line leaked a secret (%q): %s", secret, logged)
		}
	}
}

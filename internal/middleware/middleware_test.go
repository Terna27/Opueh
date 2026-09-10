package middleware

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoverer_ConvertsPanicTo500(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(&strings.Builder{}, nil))

	handler := Recoverer(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"code":"INTERNAL"`) {
		t.Errorf("expected INTERNAL error body, got %s", body)
	}
	if body := rec.Body.String(); strings.Contains(body, "boom") {
		t.Errorf("panic value leaked into response: %s", body)
	}
}

func TestRecoverer_PassesThroughNormalRequests(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(&strings.Builder{}, nil))

	handler := Recoverer(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
}

func TestLogger_RecordsStatusAndRequestID(t *testing.T) {
	var buf strings.Builder
	logger := slog.New(slog.NewTextHandler(&buf, nil))

	finalHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})

	handler := RequestID(Logger(logger)(finalHandler))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/things", nil)
	req.Header.Set(RequestIDHeader, "req-log-1")

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if got := rec.Header().Get(RequestIDHeader); got != "req-log-1" {
		t.Errorf("response request ID = %q, want %q", got, "req-log-1")
	}

	logged := buf.String()

	for _, want := range []string{
		"http_request",
		"request_id=req-log-1",
		"method=POST",
		"path=/things",
		"status=201",
	} {
		if !strings.Contains(logged, want) {
			t.Errorf("log line missing %q: %s", want, logged)
		}
	}
}

func TestLogger_500sLoggedAtErrorLevel(t *testing.T) {
	var buf strings.Builder
	logger := slog.New(slog.NewTextHandler(&buf, nil))

	handler := Logger(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	if !strings.Contains(buf.String(), "level=ERROR") {
		t.Errorf("5xx should be logged at ERROR level, got: %s", buf.String())
	}
}

package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakePinger struct {
	err error
}

func (f fakePinger) Ping(ctx context.Context) error { return f.err }

func newTestHealthHandler(p Pinger) *HealthHandler {
	return NewHealthHandler(p, slog.New(slog.NewTextHandler(&strings.Builder{}, nil)), 100*time.Millisecond)
}

func TestHealth_ReturnsOK(t *testing.T) {
	h := newTestHealthHandler(fakePinger{})

	rec := httptest.NewRecorder()
	h.Health(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status field = %q, want ok", body.Status)
	}
}

func TestReady_DependencyHealthy(t *testing.T) {
	h := newTestHealthHandler(fakePinger{})

	rec := httptest.NewRecorder()
	h.Ready(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status string            `json:"status"`
		Checks map[string]string `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body.Status != "ready" {
		t.Errorf("status field = %q, want ready", body.Status)
	}
	if body.Checks["postgres"] != "ok" {
		t.Errorf("postgres check = %q, want ok", body.Checks["postgres"])
	}
}

func TestReady_DependencyDown(t *testing.T) {
	h := newTestHealthHandler(fakePinger{err: errors.New("connection refused")})

	rec := httptest.NewRecorder()
	h.Ready(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body.Error.Code != "NOT_READY" {
		t.Errorf("code = %q, want NOT_READY", body.Error.Code)
	}

	// The internal failure detail must not reach the client.
	if strings.Contains(rec.Body.String(), "connection refused") {
		t.Errorf("dependency error leaked into response: %s", rec.Body.String())
	}
}

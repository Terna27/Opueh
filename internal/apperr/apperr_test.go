package apperr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteError_AppError(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/thing", nil)

	err := New(http.StatusNotFound, "THING_NOT_FOUND", "Thing not found")
	WriteError(rec, req, err)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body.Error.Code != "THING_NOT_FOUND" {
		t.Errorf("code = %q, want THING_NOT_FOUND", body.Error.Code)
	}
	if body.Error.Message != "Thing not found" {
		t.Errorf("message = %q, want %q", body.Error.Message, "Thing not found")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}
}

func TestWriteError_UnknownErrorCollapsesToInternal(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/thing", nil)

	// A raw error with internal details must never leak to the client.
	WriteError(rec, req, errors.New("pq: duplicate key value violates unique constraint \"users_email_key\""))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body.Error.Code != "INTERNAL" {
		t.Errorf("code = %q, want INTERNAL", body.Error.Code)
	}
	if body.Error.Message == "" || body.Error.Message == rec.Body.String() {
		t.Errorf("message should be a safe generic string, got %q", body.Error.Message)
	}
	if got := rec.Body.String(); strings.Contains(got, "duplicate key") {
		t.Errorf("internal error details leaked into response: %s", got)
	}
}

func TestError_Error(t *testing.T) {
	e := New(http.StatusBadRequest, "BAD", "Something went wrong")
	if e.Error() != "BAD: Something went wrong" {
		t.Errorf("Error() = %q, want %q", e.Error(), "BAD: Something went wrong")
	}
}

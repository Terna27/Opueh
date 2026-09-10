package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
)

// stubSessionsProvider records calls so tests can assert the identity and
// targets the handler derived from server-side state.
type stubSessionsProvider struct {
	listResult []models.SessionInfo
	listErr    error

	revokeUserID    uuid.UUID
	revokeSessionID uuid.UUID
	revokeErr       error
	revokeCalls     int

	revokeOthersUserID uuid.UUID
	revokeOthersKeepID uuid.UUID
	revokeOthersErr    error
	revokeOthersCalls  int
}

func (s *stubSessionsProvider) ListSessions(ctx context.Context, userID uuid.UUID) ([]models.SessionInfo, error) {
	return s.listResult, s.listErr
}

func (s *stubSessionsProvider) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	s.revokeCalls++
	s.revokeUserID = userID
	s.revokeSessionID = sessionID
	return s.revokeErr
}

func (s *stubSessionsProvider) RevokeOtherSessions(ctx context.Context, userID, keepSessionID uuid.UUID) error {
	s.revokeOthersCalls++
	s.revokeOthersUserID = userID
	s.revokeOthersKeepID = keepSessionID
	return s.revokeOthersErr
}

// serveAuthed runs req through the REAL RequireAuth middleware (backed by
// the stub authenticator) and then the handler, exactly as the router wires
// protected endpoints. The bearer header is set here because RequireAuth
// requires it — the middleware, and the handler's UserFromContext lookup,
// are both exercised, never bypassed.
func serveAuthed(t *testing.T, user *models.AuthenticatedUser, next http.HandlerFunc, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	req.Header.Set("Authorization", "Bearer test-access-token")
	handler := middleware.RequireAuth(stubAuthForHandlers{user: user})(next)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestSessionsHandler_RequiresAuth(t *testing.T) {
	h := NewSessionsHandler(&stubSessionsProvider{})

	for name, call := range map[string]func(http.ResponseWriter, *http.Request){
		"list":          h.List,
		"revoke":        h.Revoke,
		"revoke-others": h.RevokeOthers,
	} {
		rec := httptest.NewRecorder()
		call(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/sessions", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want %d", name, rec.Code, http.StatusUnauthorized)
		}
		if !strings.Contains(rec.Body.String(), "UNAUTHENTICATED") {
			t.Errorf("%s: expected UNAUTHENTICATED, got %s", name, rec.Body.String())
		}
	}
}

func TestSessionsHandler_ListMarksCurrent(t *testing.T) {
	current := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	other := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	ua := "iPhone Safari"
	ip := "198.51.100.4"

	h := NewSessionsHandler(&stubSessionsProvider{
		listResult: []models.SessionInfo{
			{ID: other, CreatedAt: time.Now().UTC(), UserAgent: &ua, IPAddress: &ip},
			{ID: current, CreatedAt: time.Now().UTC().Add(time.Minute), UserAgent: &ua, IPAddress: &ip},
		},
	})

	user := &models.AuthenticatedUser{UserID: uuid.New(), SessionID: current}
	rec := serveAuthed(t, user, h.List, httptest.NewRequest(http.MethodGet, "/api/v1/auth/sessions", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp struct {
		Sessions []struct {
			ID      string `json:"id"`
			Current bool   `json:"current"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(resp.Sessions) != 2 {
		t.Fatalf("sessions = %d, want 2", len(resp.Sessions))
	}
	byID := map[string]bool{}
	for _, s := range resp.Sessions {
		byID[s.ID] = s.Current
	}
	if !byID[current.String()] || byID[other.String()] {
		t.Errorf("current flag wrong: %+v", byID)
	}
}

func TestSessionsHandler_ListErrorPassesThrough(t *testing.T) {
	h := NewSessionsHandler(&stubSessionsProvider{
		listErr: apperr.New(http.StatusInternalServerError, "INTERNAL", "boom"),
	})

	user := &models.AuthenticatedUser{UserID: uuid.New(), SessionID: uuid.New()}
	rec := serveAuthed(t, user, h.List, httptest.NewRequest(http.MethodGet, "/api/v1/auth/sessions", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestSessionsHandler_Revoke(t *testing.T) {
	sessionID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	provider := &stubSessionsProvider{}
	h := NewSessionsHandler(provider)

	user := &models.AuthenticatedUser{UserID: uuid.New(), SessionID: uuid.New()}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/sessions/"+sessionID.String(), nil)
	addChiParam(req, "sessionID", sessionID.String())
	rec := serveAuthed(t, user, h.Revoke, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	if provider.revokeUserID != user.UserID || provider.revokeSessionID != sessionID {
		t.Errorf("revoked (%s, %s), want (%s, %s) — identity must come from context",
			provider.revokeUserID, provider.revokeSessionID, user.UserID, sessionID)
	}
}

func TestSessionsHandler_RevokeInvalidUUID(t *testing.T) {
	h := NewSessionsHandler(&stubSessionsProvider{})

	user := &models.AuthenticatedUser{UserID: uuid.New(), SessionID: uuid.New()}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/sessions/not-a-uuid", nil)
	addChiParam(req, "sessionID", "not-a-uuid")
	rec := serveAuthed(t, user, h.Revoke, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("expected VALIDATION_ERROR, got %s", rec.Body.String())
	}
}

func TestSessionsHandler_RevokeNotFoundPassesThrough(t *testing.T) {
	h := NewSessionsHandler(&stubSessionsProvider{
		revokeErr: apperr.New(http.StatusNotFound, "SESSION_NOT_FOUND", "Session not found"),
	})

	user := &models.AuthenticatedUser{UserID: uuid.New(), SessionID: uuid.New()}

	sessionID := uuid.New()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/sessions/"+sessionID.String(), nil)
	addChiParam(req, "sessionID", sessionID.String())
	rec := serveAuthed(t, user, h.Revoke, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "SESSION_NOT_FOUND") {
		t.Errorf("expected SESSION_NOT_FOUND, got %s", rec.Body.String())
	}
}

func TestSessionsHandler_RevokeOthers(t *testing.T) {
	provider := &stubSessionsProvider{}
	h := NewSessionsHandler(provider)

	user := &models.AuthenticatedUser{UserID: uuid.New(), SessionID: uuid.New()}
	rec := serveAuthed(t, user, h.RevokeOthers, httptest.NewRequest(http.MethodPost, "/api/v1/auth/sessions/revoke-others", nil))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	if provider.revokeOthersUserID != user.UserID {
		t.Errorf("revoked for %s, want %s", provider.revokeOthersUserID, user.UserID)
	}
	if provider.revokeOthersKeepID != user.SessionID {
		t.Errorf("kept %s, want the current session %s", provider.revokeOthersKeepID, user.SessionID)
	}
}

// addChiParam injects a chi URL parameter the way the real router would.
func addChiParam(req *http.Request, key, value string) {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	*req = *req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// TestAuthEndpoints_BodySizeLimit verifies the tighter auth-group body
// limit: a login body larger than the configured auth limit is rejected
// with 413 before the service is ever called.
func TestAuthEndpoints_BodySizeLimit(t *testing.T) {
	provider := &stubAuthProvider{} // login never succeeds; only the 413 matters
	h := NewAuthHandler(provider)

	handler := middleware.BodyLimit(64)(http.HandlerFunc(h.Login))

	big := `{"identifier":"jane@example.com","password":"` + strings.Repeat("x", 512) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(big))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(big))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
	if !strings.Contains(rec.Body.String(), "REQUEST_TOO_LARGE") {
		t.Errorf("expected REQUEST_TOO_LARGE, got %s", rec.Body.String())
	}
}

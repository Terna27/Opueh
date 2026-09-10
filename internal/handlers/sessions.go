package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
)

// SessionsProvider is the service surface the session-management handlers
// depend on. The concrete *services.AuthService satisfies it; tests use
// stubs. Identity always comes from the auth middleware's server-side
// state, never from the request.
type SessionsProvider interface {
	ListSessions(ctx context.Context, userID uuid.UUID) ([]models.SessionInfo, error)
	RevokeSession(ctx context.Context, userID, sessionID uuid.UUID) error
	RevokeOtherSessions(ctx context.Context, userID, keepSessionID uuid.UUID) error
}

// SessionsHandler serves the authenticated session-management endpoints.
type SessionsHandler struct {
	sessions SessionsProvider
}

// NewSessionsHandler constructs the sessions handler.
func NewSessionsHandler(sessions SessionsProvider) *SessionsHandler {
	return &SessionsHandler{sessions: sessions}
}

// sessionResponse is the public representation of an active session. It
// carries metadata only — never token material.
type sessionResponse struct {
	ID         string     `json:"id"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	UserAgent  *string    `json:"user_agent"`
	IPAddress  *string    `json:"ip_address"`
	Current    bool       `json:"current"`
}

func newSessionResponse(s models.SessionInfo, currentSessionID uuid.UUID) sessionResponse {
	return sessionResponse{
		ID:         s.ID.String(),
		CreatedAt:  s.CreatedAt,
		LastUsedAt: s.LastUsedAt,
		ExpiresAt:  s.ExpiresAt,
		UserAgent:  s.UserAgent,
		IPAddress:  s.IPAddress,
		Current:    s.ID == currentSessionID,
	}
}

// List handles GET /api/v1/auth/sessions (requires authentication).
func (h *SessionsHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	sessions, err := h.sessions.ListSessions(r.Context(), user.UserID)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	out := make([]sessionResponse, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, newSessionResponse(s, user.SessionID))
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// Revoke handles DELETE /api/v1/auth/sessions/{session_id} (requires
// authentication). The session being revoked is named in the URL; ownership
// is enforced in the service/store, so a foreign session id is simply
// SESSION_NOT_FOUND.
func (h *SessionsHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	sessionID, err := uuid.Parse(chi.URLParam(r, "sessionID"))
	if err != nil {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "session_id must be a valid UUID"))
		return
	}

	if err := h.sessions.RevokeSession(r.Context(), user.UserID, sessionID); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// RevokeOthers handles POST /api/v1/auth/sessions/revoke-others (requires
// authentication). The current session comes from server-side auth state
// and is always the one preserved.
func (h *SessionsHandler) RevokeOthers(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	if err := h.sessions.RevokeOtherSessions(r.Context(), user.UserID, user.SessionID); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

package handlers

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
)

// MeProvider is the service surface the me handler depends on.
type MeProvider interface {
	GetUser(ctx context.Context, userID uuid.UUID) (*models.User, error)
}

// MeHandler serves the authenticated-user endpoints.
type MeHandler struct {
	me MeProvider
}

// NewMeHandler constructs the me handler.
func NewMeHandler(me MeProvider) *MeHandler {
	return &MeHandler{me: me}
}

// Me handles GET /api/v1/me. The user identity comes from the auth
// middleware context, not from any client-supplied value.
func (h *MeHandler) Me(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	user, err := h.me.GetUser(r.Context(), authUser.UserID)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, newUserResponse(user))
}

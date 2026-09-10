package handlers

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/services"
)

// AuthProvider is the service surface the auth handlers depend on. The
// concrete *services.AuthService satisfies it; tests use stubs.
type AuthProvider interface {
	Register(ctx context.Context, in services.RegisterInput, meta services.ClientMeta) (*services.AuthResult, error)
	Login(ctx context.Context, in services.LoginInput, meta services.ClientMeta) (*services.AuthResult, error)
	Refresh(ctx context.Context, refreshToken string, meta services.ClientMeta) (*services.AuthResult, error)
	Logout(ctx context.Context, sessionID uuid.UUID) error
}

// AuthHandler serves /api/v1/auth/*.
type AuthHandler struct {
	auth AuthProvider
}

// NewAuthHandler constructs the auth handler.
func NewAuthHandler(auth AuthProvider) *AuthHandler {
	return &AuthHandler{auth: auth}
}

type registerRequest struct {
	Email       string `json:"email"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

// Register handles POST /api/v1/auth/register.
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	if err := validateRegistration(req.Email, req.Username, req.Password, req.DisplayName); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	result, err := h.auth.Register(r.Context(), services.RegisterInput{
		Email:       req.Email,
		Username:    req.Username,
		Password:    req.Password,
		DisplayName: req.DisplayName,
	}, clientMeta(r))
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, newAuthResponse(result))
}

type loginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

// Login handles POST /api/v1/auth/login.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	if err := validateLogin(req.Identifier, req.Password); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	result, err := h.auth.Login(r.Context(), services.LoginInput{
		Identifier: req.Identifier,
		Password:   req.Password,
	}, clientMeta(r))
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, newAuthResponse(result))
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// Refresh handles POST /api/v1/auth/refresh. No access token required —
// the refresh token is the credential.
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	if req.RefreshToken == "" {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "refresh_token is required"))
		return
	}

	result, err := h.auth.Refresh(r.Context(), req.RefreshToken, clientMeta(r))
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, newAuthResponse(result))
}

// Logout handles POST /api/v1/auth/logout (requires authentication). The
// session ID comes from server-side state established by the auth
// middleware — never from the request body.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	if err := h.auth.Logout(r.Context(), user.SessionID); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

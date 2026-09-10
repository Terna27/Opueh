package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/services"
)

// AccountProvider is the service surface the account handlers depend on.
type AccountProvider interface {
	RequestEmailVerification(ctx context.Context, userID uuid.UUID) error
	VerifyEmail(ctx context.Context, token string) error
	RequestPasswordReset(ctx context.Context, email string, meta services.ClientMeta) error
	ResetPassword(ctx context.Context, token, newPassword string, meta services.ClientMeta) error
}

// AccountHandler serves the email-verification and password-recovery
// endpoints.
type AccountHandler struct {
	account AccountProvider
}

// NewAccountHandler constructs the account handler.
func NewAccountHandler(account AccountProvider) *AccountHandler {
	return &AccountHandler{account: account}
}

type messageResponse struct {
	Message string `json:"message"`
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

// RequestEmailVerification handles POST /api/v1/auth/email/verify/request
// (requires authentication). The user identity comes from the auth
// middleware context — never from the request body.
func (h *AccountHandler) RequestEmailVerification(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	if err := h.account.RequestEmailVerification(r.Context(), user.UserID); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	// Deliberately vague: the message must not confirm whether the email
	// was already verified or a new link was sent.
	writeJSON(w, http.StatusOK, messageResponse{Message: "If your email is not verified yet, a verification link has been sent."})
}

// VerifyEmail handles POST /api/v1/auth/email/verify. The token itself is
// the credential; no access token required (the user may be following a link
// from an email in a fresh browser).
func (h *AccountHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}
	if req.Token == "" {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "token is required"))
		return
	}

	if err := h.account.VerifyEmail(r.Context(), req.Token); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, messageResponse{Message: "Your email has been verified."})
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

// ForgotPassword handles POST /api/v1/auth/password/forgot. The response is
// IDENTICAL whether or not the email belongs to an account — this handler
// must never leak account existence.
func (h *AccountHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	email := strings.TrimSpace(req.Email)
	if email == "" || len(email) > 254 || !emailRegex.MatchString(email) {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "email must be a valid email address"))
		return
	}

	if err := h.account.RequestPasswordReset(r.Context(), email, clientMeta(r)); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, messageResponse{Message: "If an account exists for this email, a password reset link has been sent."})
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// ResetPassword handles POST /api/v1/auth/password/reset. The single-use
// reset token is the credential; no access token required.
func (h *AccountHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	var problems []string
	if req.Token == "" {
		problems = append(problems, "token is required")
	}
	switch {
	case len(req.NewPassword) < 8:
		problems = append(problems, "new_password must be at least 8 characters")
	case len(req.NewPassword) > 128:
		problems = append(problems, "new_password must be at most 128 characters")
	}
	if len(problems) > 0 {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", strings.Join(problems, "; ")))
		return
	}

	if err := h.account.ResetPassword(r.Context(), req.Token, req.NewPassword, clientMeta(r)); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, messageResponse{Message: "Your password has been reset. Please log in with your new password."})
}

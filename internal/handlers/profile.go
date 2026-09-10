package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/services"
)

// ProfileProvider is the service surface the profile handlers depend on.
type ProfileProvider interface {
	GetMyProfile(ctx context.Context, userID uuid.UUID) (*models.Profile, error)
	GetPublicProfile(ctx context.Context, username string) (*models.Profile, error)
	UpdateMyProfile(ctx context.Context, userID uuid.UUID, in services.ProfileUpdateInput) (*models.Profile, error)
}

// ProfileHandler serves the profile endpoints.
type ProfileHandler struct {
	profiles ProfileProvider
}

// NewProfileHandler constructs the profile handler.
func NewProfileHandler(profiles ProfileProvider) *ProfileHandler {
	return &ProfileHandler{profiles: profiles}
}

// myProfileResponse is the owner's view of their own profile: the public
// fields plus owner-only account information. It is built field by field
// from the model — the model is never serialized directly — and contains no
// password hash, token material, or session/security state.
type myProfileResponse struct {
	ID            string    `json:"id"`
	Username      string    `json:"username"`
	DisplayName   string    `json:"display_name"`
	Bio           *string   `json:"bio"`
	Email         string    `json:"email"`
	Role          string    `json:"role"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func newMyProfileResponse(p *models.Profile) myProfileResponse {
	return myProfileResponse{
		ID:            p.UserID.String(),
		Username:      p.Username,
		DisplayName:   p.DisplayName,
		Bio:           p.Bio,
		Email:         p.Email,
		Role:          p.Role,
		EmailVerified: p.EmailVerifiedAt != nil,
		CreatedAt:     p.CreatedAt,
		UpdatedAt:     p.UpdatedAt,
	}
}

// publicProfileResponse is what any visitor may see about a user. It
// deliberately excludes email, role, account status, verification state and
// every internal security field — exposure is this whitelist, nothing else.
type publicProfileResponse struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Bio         *string   `json:"bio"`
	CreatedAt   time.Time `json:"created_at"`
}

func newPublicProfileResponse(p *models.Profile) publicProfileResponse {
	return publicProfileResponse{
		ID:          p.UserID.String(),
		Username:    p.Username,
		DisplayName: p.DisplayName,
		Bio:         p.Bio,
		CreatedAt:   p.CreatedAt,
	}
}

// MyProfile handles GET /api/v1/me/profile. The identity comes from the
// auth middleware context, never from the client.
func (h *ProfileHandler) MyProfile(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	profile, err := h.profiles.GetMyProfile(r.Context(), authUser.UserID)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, newMyProfileResponse(profile))
}

type profilePatchRequest struct {
	DisplayName *string `json:"display_name"`
	Bio         *string `json:"bio"`
}

// UpdateMyProfile handles PATCH /api/v1/me/profile. Only supplied fields
// change; the user being modified is exclusively the authenticated user
// from the middleware context — nothing in the body, query, path or headers
// can redirect the update to another account.
func (h *ProfileHandler) UpdateMyProfile(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	var req profilePatchRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	// Boundary validation mirrors the service rules for fast feedback; the
	// service enforces them again as the authority.
	if err := validateProfilePatch(req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	profile, err := h.profiles.UpdateMyProfile(r.Context(), authUser.UserID, services.ProfileUpdateInput{
		DisplayName: req.DisplayName,
		Bio:         req.Bio,
	})
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, newMyProfileResponse(profile))
}

// PublicProfile handles GET /api/v1/users/{username}. Deliberately public:
// no authentication required, and the response shape carries only the
// public whitelist of fields.
func (h *ProfileHandler) PublicProfile(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")

	profile, err := h.profiles.GetPublicProfile(r.Context(), username)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, newPublicProfileResponse(profile))
}

// validateProfilePatch checks PATCH /me/profile input shape at the HTTP
// boundary. The same rules are enforced in the service, which is the
// authority — this pass exists to reject bad input before any service call.
func validateProfilePatch(req profilePatchRequest) error {
	if req.DisplayName == nil && req.Bio == nil {
		return apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
			"at least one field (display_name, bio) must be supplied")
	}

	var problems []string

	if req.DisplayName != nil {
		displayName := strings.TrimSpace(*req.DisplayName)
		if displayName == "" {
			problems = append(problems, "display_name cannot be empty when supplied")
		}
		if len(displayName) > services.MaxDisplayNameLength {
			problems = append(problems, fmt.Sprintf("display_name must be at most %d characters", services.MaxDisplayNameLength))
		}
	}

	if req.Bio != nil {
		if len(strings.TrimSpace(*req.Bio)) > services.MaxBioLength {
			problems = append(problems, fmt.Sprintf("bio must be at most %d characters", services.MaxBioLength))
		}
	}

	if len(problems) > 0 {
		return apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", strings.Join(problems, "; "))
	}
	return nil
}

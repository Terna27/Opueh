package handlers

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/services"
)

// CategoryProvider is the service surface the category handlers depend on.
type CategoryProvider interface {
	ListCategories(ctx context.Context) ([]models.Category, error)
	GetMyInterests(ctx context.Context, userID uuid.UUID) ([]models.Category, error)
	ReplaceMyInterests(ctx context.Context, userID uuid.UUID, categoryIDs []string) ([]models.Category, error)
}

// CategoryHandler serves the category and interest endpoints.
type CategoryHandler struct {
	categories CategoryProvider
}

// NewCategoryHandler constructs the category handler.
func NewCategoryHandler(categories CategoryProvider) *CategoryHandler {
	return &CategoryHandler{categories: categories}
}

// categoryResponse is the public-safe category representation. It exposes
// only fields a client needs to display or select a category; internal
// administrative metadata (created_at) stays out.
type categoryResponse struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description"`
}

func newCategoryResponse(c models.Category) categoryResponse {
	return categoryResponse{
		ID:          c.ID.String(),
		Name:        c.Name,
		Slug:        c.Slug,
		Description: c.Description,
	}
}

func newCategoryResponses(categories []models.Category) []categoryResponse {
	out := make([]categoryResponse, 0, len(categories)) // empty slice, not null, when none
	for _, c := range categories {
		out = append(out, newCategoryResponse(c))
	}
	return out
}

// List handles GET /api/v1/categories. Deliberately public: the selectable
// taxonomy is not sensitive and clients need it before signup/login flows
// such as onboarding.
func (h *CategoryHandler) List(w http.ResponseWriter, r *http.Request) {
	categories, err := h.categories.ListCategories(r.Context())
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, struct {
		Categories []categoryResponse `json:"categories"`
	}{Categories: newCategoryResponses(categories)})
}

// MyInterests handles GET /api/v1/me/interests. The identity comes from
// the auth middleware context, never from the client.
func (h *CategoryHandler) MyInterests(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	categories, err := h.categories.GetMyInterests(r.Context(), authUser.UserID)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, struct {
		Interests []categoryResponse `json:"interests"`
	}{Interests: newCategoryResponses(categories)})
}

type replaceInterestsRequest struct {
	CategoryIDs []string `json:"category_ids"`
}

// ReplaceInterests handles PUT /api/v1/me/interests. PUT, not PATCH: the
// body is the user's COMPLETE interest selection, replaced atomically. The
// user being modified is exclusively the authenticated user from the
// middleware context — nothing in the body, path, query or headers can
// redirect the write to another account.
func (h *CategoryHandler) ReplaceInterests(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required"))
		return
	}

	var req replaceInterestsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	// Boundary prevalidation mirrors the service rules for fast feedback;
	// the service enforces them again as the authority.
	if req.CategoryIDs == nil {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "category_ids is required"))
		return
	}
	if len(req.CategoryIDs) < services.MinInterests || len(req.CategoryIDs) > services.MaxInterests {
		apperr.WriteError(w, r, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
			"category_ids must contain between 1 and 10 categories"))
		return
	}

	categories, err := h.categories.ReplaceMyInterests(r.Context(), authUser.UserID, req.CategoryIDs)
	if err != nil {
		apperr.WriteError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, struct {
		Interests []categoryResponse `json:"interests"`
	}{Interests: newCategoryResponses(categories)})
}

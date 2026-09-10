package services

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// Interest selection limits. A selection drives personalization, so at
// least one category is required; ten keeps onboarding choices (and the
// stored set) bounded. Enforced here authoritatively; handlers mirror the
// rules for fast feedback.
const (
	MinInterests = 1
	MaxInterests = 10
)

// CategoryStore is the persistence the category service needs from the
// categories/user_categories tables. Satisfied by
// repositories.CategoryRepository.
type CategoryStore interface {
	ListSelectable(ctx context.Context) ([]models.Category, error)
	ListUserInterests(ctx context.Context, userID uuid.UUID) ([]models.Category, error)
	ReplaceUserInterests(ctx context.Context, userID uuid.UUID, categoryIDs []uuid.UUID) ([]models.Category, error)
}

// CategoryService implements the category/interest domain: public category
// listing and a user's explicit interest selection. It deliberately stores
// preferences only — no ranking, recommendations or feeds (later
// milestones consume this selection via the join table).
type CategoryService struct {
	categories CategoryStore
}

// NewCategoryService constructs the service with its dependencies injected.
func NewCategoryService(categories CategoryStore) *CategoryService {
	return &CategoryService{categories: categories}
}

// ListCategories returns every selectable category. The database is the
// source of truth: platform-managed rows, no hardcoded list in code.
func (s *CategoryService) ListCategories(ctx context.Context) ([]models.Category, error) {
	categories, err := s.categories.ListSelectable(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	return categories, nil
}

// GetMyInterests returns the authenticated user's selected categories.
// No selection yet is a valid state and yields an empty list.
func (s *CategoryService) GetMyInterests(ctx context.Context, userID uuid.UUID) ([]models.Category, error) {
	categories, err := s.categories.ListUserInterests(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get interests: %w", err)
	}
	return categories, nil
}

// ReplaceMyInterests atomically replaces the user's complete interest
// selection. categoryIDs arrives as raw strings from the API; this method
// is the authority for every rule below, so the constraints cannot be
// bypassed by calling the service directly:
//
//   - 1..MaxInterests categories (an empty selection is not a valid state
//     for this feature),
//   - every ID must be a well-formed UUID,
//   - duplicates are rejected, not silently deduplicated — duplicate input
//     signals a client bug.
//
// Existence/selectability of the categories themselves is verified inside
// the transactional repository operation, so validation cannot race with
// the write.
func (s *CategoryService) ReplaceMyInterests(ctx context.Context, userID uuid.UUID, categoryIDs []string) ([]models.Category, error) {
	if len(categoryIDs) < MinInterests {
		return nil, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
			fmt.Sprintf("at least %d category must be supplied", MinInterests))
	}
	if len(categoryIDs) > MaxInterests {
		return nil, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
			fmt.Sprintf("at most %d categories may be selected", MaxInterests))
	}

	seen := make(map[uuid.UUID]struct{}, len(categoryIDs))
	parsed := make([]uuid.UUID, 0, len(categoryIDs))
	for _, raw := range categoryIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			return nil, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "category_ids must contain valid UUIDs")
		}
		if _, dup := seen[id]; dup {
			return nil, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "category_ids must not contain duplicate values")
		}
		seen[id] = struct{}{}
		parsed = append(parsed, id)
	}

	categories, err := s.categories.ReplaceUserInterests(ctx, userID, parsed)
	if err != nil {
		switch {
		case errors.Is(err, repositories.ErrCategoryNotFound):
			return nil, apperr.New(http.StatusNotFound, "CATEGORY_NOT_FOUND", "One or more categories do not exist")
		case errors.Is(err, repositories.ErrNotFound):
			return nil, apperr.New(http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		}
		return nil, fmt.Errorf("replace interests: %w", err)
	}
	return categories, nil
}

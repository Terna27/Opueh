package services

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// Profile field limits. The same values are enforced at the HTTP boundary
// (fast feedback) and here (the authoritative rules, so no caller can bypass
// them by using the service directly). Bio's limit is additionally backed by
// a database CHECK constraint.
const (
	MaxDisplayNameLength = 50
	MaxBioLength         = 500
)

// ProfileUpdateInput is a partial profile update as received from the API.
// A nil field means "not supplied — leave unchanged". A supplied bio of
// only whitespace clears the bio; a supplied display name must be non-empty.
// The interpretation happens here, in one place.
type ProfileUpdateInput struct {
	DisplayName *string
	Bio         *string
}

// ProfileStore is the persistence the profile service needs from the
// users/user_profiles tables. Satisfied by repositories.UserRepository.
type ProfileStore interface {
	GetProfileByID(ctx context.Context, userID uuid.UUID) (*models.Profile, error)
	GetPublicProfileByUsername(ctx context.Context, username string) (*models.Profile, error)
	UpdateProfile(ctx context.Context, userID uuid.UUID, patch repositories.ProfilePatch) (*models.Profile, error)
}

// ProfileService implements the profile domain: the owner's full (but still
// secret-free) profile, partial self-updates, and public lookup by username.
type ProfileService struct {
	profiles ProfileStore
}

// NewProfileService constructs the service with its dependencies injected.
func NewProfileService(profiles ProfileStore) *ProfileService {
	return &ProfileService{profiles: profiles}
}

func userNotFound() *apperr.Error {
	return apperr.New(http.StatusNotFound, "USER_NOT_FOUND", "User not found")
}

// GetMyProfile returns the authenticated user's own profile. The caller is
// expected to be authenticated; ownership is the caller's identity itself,
// never anything the client supplied.
func (s *ProfileService) GetMyProfile(ctx context.Context, userID uuid.UUID) (*models.Profile, error) {
	profile, err := s.profiles.GetProfileByID(ctx, userID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, userNotFound()
		}
		return nil, fmt.Errorf("get own profile: %w", err)
	}
	return profile, nil
}

// GetPublicProfile returns the public-safe profile for a username. Deleted,
// suspended, banned and unknown usernames all produce the same
// USER_NOT_FOUND — the lookup reveals nothing about account state.
func (s *ProfileService) GetPublicProfile(ctx context.Context, username string) (*models.Profile, error) {
	// No shape validation here on purpose: a username that could never exist
	// matches nothing in the database and comes back as the same uniform
	// not-found as any other miss.
	profile, err := s.profiles.GetPublicProfileByUsername(ctx, strings.TrimSpace(username))
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, userNotFound()
		}
		return nil, fmt.Errorf("get public profile: %w", err)
	}
	return profile, nil
}

// UpdateMyProfile applies a partial update to the authenticated user's own
// profile and returns the updated profile. Only the supplied fields change.
func (s *ProfileService) UpdateMyProfile(ctx context.Context, userID uuid.UUID, in ProfileUpdateInput) (*models.Profile, error) {
	patch, err := buildProfilePatch(in)
	if err != nil {
		return nil, err
	}

	profile, err := s.profiles.UpdateProfile(ctx, userID, patch)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, userNotFound()
		}
		return nil, fmt.Errorf("update profile: %w", err)
	}
	return profile, nil
}

// buildProfilePatch validates the update input and translates it into a
// repository patch. This is the authoritative enforcement of the profile
// business rules: handlers pre-validate for fast feedback, but anything
// that reaches the store goes through here.
func buildProfilePatch(in ProfileUpdateInput) (repositories.ProfilePatch, error) {
	if in.DisplayName == nil && in.Bio == nil {
		return repositories.ProfilePatch{}, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
			"at least one field (display_name, bio) must be supplied")
	}

	var patch repositories.ProfilePatch

	if in.DisplayName != nil {
		displayName := strings.TrimSpace(*in.DisplayName)
		switch {
		case displayName == "":
			return patch, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
				"display_name cannot be empty when supplied")
		case len(displayName) > MaxDisplayNameLength:
			return patch, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
				fmt.Sprintf("display_name must be at most %d characters", MaxDisplayNameLength))
		}
		patch.UpdateDisplayName = true
		patch.DisplayName = displayName
	}

	if in.Bio != nil {
		// Trim stray leading/trailing whitespace but keep interior
		// newlines: bio is prose, and its formatting is user content.
		bio := strings.TrimSpace(*in.Bio)
		if bio == "" {
			// An explicitly supplied empty bio clears it.
			patch.UpdateBio = true
			patch.Bio = nil
		} else {
			if len(bio) > MaxBioLength {
				return patch, apperr.New(http.StatusBadRequest, "VALIDATION_ERROR",
					fmt.Sprintf("bio must be at most %d characters", MaxBioLength))
			}
			patch.UpdateBio = true
			patch.Bio = &bio
		}
	}

	return patch, nil
}

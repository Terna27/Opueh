package services

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// fakeProfileStore is an in-memory ProfileStore. It mirrors the repository
// contract: ErrNotFound for unknown keys, copies on return, and patches
// recorded so tests can assert exactly what the service asked the store to
// write.
type fakeProfileStore struct {
	profiles map[uuid.UUID]*models.Profile

	publicErr error // when set, every public lookup fails with it

	updatedFor []uuid.UUID
	patches    []repositories.ProfilePatch
}

func newFakeProfileStore(t *testing.T) *fakeProfileStore {
	t.Helper()
	return &fakeProfileStore{profiles: map[uuid.UUID]*models.Profile{}}
}

func (f *fakeProfileStore) seed(t *testing.T, p *models.Profile) *models.Profile {
	t.Helper()
	f.profiles[p.UserID] = p
	return p
}

func (f *fakeProfileStore) GetProfileByID(ctx context.Context, userID uuid.UUID) (*models.Profile, error) {
	p, ok := f.profiles[userID]
	if !ok {
		return nil, fmt.Errorf("%w: profile for user %s", repositories.ErrNotFound, userID)
	}
	cp := *p
	return &cp, nil
}

func (f *fakeProfileStore) GetPublicProfileByUsername(ctx context.Context, username string) (*models.Profile, error) {
	if f.publicErr != nil {
		return nil, f.publicErr
	}
	for _, p := range f.profiles {
		// citext-equivalent matching.
		if strings.EqualFold(p.Username, username) {
			cp := *p
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("%w: user %q", repositories.ErrNotFound, username)
}

func (f *fakeProfileStore) UpdateProfile(ctx context.Context, userID uuid.UUID, patch repositories.ProfilePatch) (*models.Profile, error) {
	p, ok := f.profiles[userID]
	if !ok {
		return nil, fmt.Errorf("%w: profile for user %s", repositories.ErrNotFound, userID)
	}
	f.updatedFor = append(f.updatedFor, userID)
	f.patches = append(f.patches, patch)
	if patch.UpdateDisplayName {
		p.DisplayName = patch.DisplayName
	}
	if patch.UpdateBio {
		p.Bio = patch.Bio
	}
	cp := *p
	return &cp, nil
}

func seededProfile(userID uuid.UUID) *models.Profile {
	return &models.Profile{
		UserID:      userID,
		Username:    "jane_doe",
		DisplayName: "Jane Doe",
		Bio:         nil,
		Email:       "jane@example.com",
		Role:        "USER",
		Status:      "ACTIVE",
	}
}

func TestProfileService_GetMyProfile(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	profile, err := svc.GetMyProfile(context.Background(), userID)
	if err != nil {
		t.Fatalf("GetMyProfile: %v", err)
	}
	if profile.UserID != userID || profile.Username != "jane_doe" || profile.DisplayName != "Jane Doe" {
		t.Errorf("profile = %+v", profile)
	}
}

func TestProfileService_GetMyProfile_NotFound(t *testing.T) {
	svc := NewProfileService(newFakeProfileStore(t))

	_, err := svc.GetMyProfile(context.Background(), uuid.New())
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

func TestProfileService_UpdateMyProfile_DisplayNameOnly(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	displayName := "Jane Renamed"
	profile, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{DisplayName: &displayName})
	if err != nil {
		t.Fatalf("UpdateMyProfile: %v", err)
	}

	if len(store.patches) != 1 {
		t.Fatalf("patches = %d, want 1", len(store.patches))
	}
	patch := store.patches[0]
	if !patch.UpdateDisplayName || patch.DisplayName != "Jane Renamed" {
		t.Errorf("patch display name = %+v", patch)
	}
	if patch.UpdateBio {
		t.Error("bio must not be touched when not supplied")
	}
	if profile.DisplayName != "Jane Renamed" {
		t.Errorf("returned display name = %q", profile.DisplayName)
	}
}

func TestProfileService_UpdateMyProfile_BioOnly(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	bio := "Video creator."
	profile, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{Bio: &bio})
	if err != nil {
		t.Fatalf("UpdateMyProfile: %v", err)
	}

	patch := store.patches[0]
	if !patch.UpdateBio || patch.Bio == nil || *patch.Bio != "Video creator." {
		t.Errorf("patch bio = %+v", patch)
	}
	if patch.UpdateDisplayName {
		t.Error("display name must not be touched when not supplied")
	}
	if profile.DisplayName != "Jane Doe" {
		t.Errorf("display name changed: %q", profile.DisplayName)
	}
}

func TestProfileService_UpdateMyProfile_BothFields(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	displayName := "JD"
	bio := "New bio"
	if _, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{DisplayName: &displayName, Bio: &bio}); err != nil {
		t.Fatalf("UpdateMyProfile: %v", err)
	}

	patch := store.patches[0]
	if !patch.UpdateDisplayName || !patch.UpdateBio {
		t.Errorf("both flags must be set: %+v", patch)
	}
	if patch.DisplayName != "JD" || *patch.Bio != "New bio" {
		t.Errorf("patch values = %+v", patch)
	}
}

func TestProfileService_UpdateMyProfile_TrimsWhitespace(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	displayName := "  Padded Name  "
	bio := "\n\tLine one\n\nLine two\t"
	if _, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{DisplayName: &displayName, Bio: &bio}); err != nil {
		t.Fatalf("UpdateMyProfile: %v", err)
	}

	patch := store.patches[0]
	if patch.DisplayName != "Padded Name" {
		t.Errorf("display name = %q, want trimmed", patch.DisplayName)
	}
	// Edges trimmed, interior newlines preserved — bio formatting is user
	// content, not noise.
	if *patch.Bio != "Line one\n\nLine two" {
		t.Errorf("bio = %q, want edge-trimmed with interior newlines kept", *patch.Bio)
	}
}

func TestProfileService_UpdateMyProfile_EmptyBioClears(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	existing := seededProfile(userID)
	bio := "Old bio"
	existing.Bio = &bio
	store.seed(t, existing)
	svc := NewProfileService(store)

	empty := "   "
	profile, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{Bio: &empty})
	if err != nil {
		t.Fatalf("UpdateMyProfile: %v", err)
	}

	patch := store.patches[0]
	if !patch.UpdateBio {
		t.Fatal("supplied empty bio must be an explicit update")
	}
	if patch.Bio != nil {
		t.Errorf("empty bio must clear (nil), got %q", *patch.Bio)
	}
	if profile.Bio != nil {
		t.Errorf("returned bio = %q, want nil", *profile.Bio)
	}
}

func TestProfileService_UpdateMyProfile_EmptyPatchRejected(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	_, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{})
	assertAppErr(t, err, 400, "VALIDATION_ERROR")

	if len(store.patches) != 0 {
		t.Errorf("store must not be touched, got %d patches", len(store.patches))
	}
}

func TestProfileService_UpdateMyProfile_EmptyDisplayNameRejected(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	displayName := "   "
	if _, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{DisplayName: &displayName}); err == nil {
		t.Error("whitespace-only display_name must be rejected")
	}
	if len(store.patches) != 0 {
		t.Errorf("store must not be touched, got %d patches", len(store.patches))
	}
}

func TestProfileService_UpdateMyProfile_OversizedFieldsRejected(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	displayName := strings.Repeat("x", MaxDisplayNameLength+1)
	_, err := svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{DisplayName: &displayName})
	assertAppErr(t, err, 400, "VALIDATION_ERROR")

	bio := strings.Repeat("x", MaxBioLength+1)
	_, err = svc.UpdateMyProfile(context.Background(), userID, ProfileUpdateInput{Bio: &bio})
	assertAppErr(t, err, 400, "VALIDATION_ERROR")

	if len(store.patches) != 0 {
		t.Errorf("store must not be touched, got %d patches", len(store.patches))
	}
}

func TestProfileService_UpdateMyProfile_NotFound(t *testing.T) {
	svc := NewProfileService(newFakeProfileStore(t))

	displayName := "Ghost"
	_, err := svc.UpdateMyProfile(context.Background(), uuid.New(), ProfileUpdateInput{DisplayName: &displayName})
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

func TestProfileService_GetPublicProfile(t *testing.T) {
	store := newFakeProfileStore(t)
	userID := uuid.New()
	store.seed(t, seededProfile(userID))
	svc := NewProfileService(store)

	// Case-insensitive, like the citext lookup the real store does.
	profile, err := svc.GetPublicProfile(context.Background(), "JANE_DOE")
	if err != nil {
		t.Fatalf("GetPublicProfile: %v", err)
	}
	if profile.UserID != userID {
		t.Errorf("found user %s, want %s", profile.UserID, userID)
	}

	// The store filters non-public accounts; from the service's side they
	// are simply not found.
	store.publicErr = fmt.Errorf("%w: user %q", repositories.ErrNotFound, "jane_doe")
	_, err = svc.GetPublicProfile(context.Background(), "jane_doe")
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

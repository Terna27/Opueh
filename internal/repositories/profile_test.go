package repositories

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// These tests run against a real database (make test-db) and verify the
// profile SQL: the join, partial-update atomicity, the updated_at trigger,
// and the public-lookup visibility rules.

func TestUserProfileRepository_GetAndUpdate(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	created, err := users.CreateWithProfile(ctx,
		"dana-"+suffix+"@example.com", "dana_"+suffix, "hash", "Dana Original")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, created.ID) })

	profile, err := users.GetProfileByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetProfileByID: %v", err)
	}
	if profile.UserID != created.ID || profile.Username != "dana_"+suffix {
		t.Errorf("profile identity wrong: %+v", profile)
	}
	if profile.DisplayName != "Dana Original" {
		t.Errorf("display name = %q", profile.DisplayName)
	}
	if profile.Bio != nil {
		t.Errorf("fresh bio = %q, want nil", *profile.Bio)
	}
	if profile.Email == "" || profile.Role != "USER" || profile.Status != "ACTIVE" {
		t.Errorf("owner account fields wrong: %+v", profile)
	}

	// Let the statement clock advance so updated_at must differ afterwards.
	time.Sleep(10 * time.Millisecond)

	// Partial update: display name only. Bio must remain untouched (nil).
	updated, err := users.UpdateProfile(ctx, created.ID, ProfilePatch{
		UpdateDisplayName: true,
		DisplayName:       "Dana Renamed",
	})
	if err != nil {
		t.Fatalf("UpdateProfile display name: %v", err)
	}
	if updated.DisplayName != "Dana Renamed" {
		t.Errorf("display name = %q, want %q", updated.DisplayName, "Dana Renamed")
	}
	if updated.Bio != nil {
		t.Errorf("bio changed by display-name-only update: %q", *updated.Bio)
	}
	if !updated.UpdatedAt.After(profile.CreatedAt) {
		t.Errorf("updated_at %v did not advance past created_at %v", updated.UpdatedAt, profile.CreatedAt)
	}

	// Partial update: bio only. Display name must remain untouched.
	bio := "Filmmaker and editor."
	updated, err = users.UpdateProfile(ctx, created.ID, ProfilePatch{
		UpdateBio: true,
		Bio:       &bio,
	})
	if err != nil {
		t.Fatalf("UpdateProfile bio: %v", err)
	}
	if updated.DisplayName != "Dana Renamed" {
		t.Errorf("display name changed by bio-only update: %q", updated.DisplayName)
	}
	if updated.Bio == nil || *updated.Bio != bio {
		t.Errorf("bio = %+v, want %q", updated.Bio, bio)
	}

	// Both fields at once.
	updated, err = users.UpdateProfile(ctx, created.ID, ProfilePatch{
		UpdateDisplayName: true,
		DisplayName:       "Dana Final",
		UpdateBio:         true,
		Bio:               nil, // clear
	})
	if err != nil {
		t.Fatalf("UpdateProfile both: %v", err)
	}
	if updated.DisplayName != "Dana Final" || updated.Bio != nil {
		t.Errorf("both-field update wrong: %+v %+v", updated.DisplayName, updated.Bio)
	}

	// Empty patch: no-op that returns the current profile.
	same, err := users.UpdateProfile(ctx, created.ID, ProfilePatch{})
	if err != nil {
		t.Fatalf("UpdateProfile empty patch: %v", err)
	}
	if same.DisplayName != "Dana Final" || same.Bio != nil {
		t.Errorf("empty patch changed the profile: %+v", same)
	}

	// The database CHECK backstops the application-level bio limit.
	long := strings.Repeat("x", 501)
	if _, err := users.UpdateProfile(ctx, created.ID, ProfilePatch{UpdateBio: true, Bio: &long}); err == nil {
		t.Error("501-char bio must be rejected by the database CHECK constraint")
	}

	// Unknown users surface ErrNotFound on every operation.
	if _, err := users.GetProfileByID(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetProfileByID unknown user: %v, want ErrNotFound", err)
	}
	if _, err := users.UpdateProfile(ctx, uuid.New(), ProfilePatch{UpdateDisplayName: true, DisplayName: "X"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("UpdateProfile unknown user: %v, want ErrNotFound", err)
	}
}

func TestUserProfileRepository_PublicLookupVisibility(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	makeUser := func(name string) *uuid.UUID {
		t.Helper()
		u, err := users.CreateWithProfile(ctx,
			strings.ToLower(name)+"-"+suffix+"@example.com", name+"_"+suffix, "hash", name+" Display")
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		t.Cleanup(func() { _ = users.PurgeForTests(ctx, u.ID) })
		return &u.ID
	}

	activeID := makeUser("vera")
	suspendedID := makeUser("sam")
	bannedID := makeUser("bill")
	deletedID := makeUser("dora")

	// Drive account state directly: these states are set by moderation, not
	// by any current endpoint.
	if _, err := pool.Exec(ctx, `UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, *suspendedID); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET status = 'BANNED' WHERE id = $1`, *bannedID); err != nil {
		t.Fatalf("ban: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET deleted_at = now() WHERE id = $1`, *deletedID); err != nil {
		t.Fatalf("soft-delete: %v", err)
	}

	// Active account: found, with the joined profile data.
	public, err := users.GetPublicProfileByUsername(ctx, "vera_"+suffix)
	if err != nil {
		t.Fatalf("lookup active: %v", err)
	}
	if public.UserID != *activeID || public.DisplayName != "vera Display" {
		t.Errorf("public profile wrong: %+v", public)
	}

	// citext: case-insensitive match.
	if _, err := users.GetPublicProfileByUsername(ctx, strings.ToUpper("vera_"+suffix)); err != nil {
		t.Errorf("uppercase lookup must match via citext: %v", err)
	}

	// Suspended, banned, deleted and unknown are all the same miss.
	for _, username := range []string{
		"sam_" + suffix,
		"bill_" + suffix,
		"dora_" + suffix,
		"ghost_" + suffix,
	} {
		if _, err := users.GetPublicProfileByUsername(ctx, username); !errors.Is(err, ErrNotFound) {
			t.Errorf("lookup %q: %v, want ErrNotFound", username, err)
		}
	}

	// Soft-deleted users have no owner profile either.
	if _, err := users.GetProfileByID(ctx, *deletedID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetProfileByID deleted user: %v, want ErrNotFound", err)
	}
}

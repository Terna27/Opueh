package services

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/database"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// These tests run the full profile stack over a real database (make
// test-db): registration-issued profiles, service-validated partial updates
// persisting through the repository, and the public-lookup visibility
// rules end to end.

func profileTestStack(t *testing.T) (*AuthService, *ProfileService, *pgxpool.Pool, func()) {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping profile integration test")
	}

	cfg := &config.Config{
		DatabaseURL:    url,
		DBMaxConns:     2,
		DBMinConns:     1,
		DBConnLifetime: time.Minute,
		DBConnIdleTime: 30 * time.Second,
		DBHealthCheck:  30 * time.Second,
	}
	pool, err := database.NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	userRepo := repositories.NewUserRepository(pool)
	sessionRepo := repositories.NewSessionRepository(pool)

	authSvc := NewAuthService(
		userRepo, sessionRepo,
		auth.NewJWTManager(testJWTSecret, testJWTIssuer, 15*time.Minute),
		AuthConfig{AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, SessionTTL: 24 * time.Hour},
		NoopLoginProtection(), // brute-force limits are not under test here
	)
	profileSvc := NewProfileService(userRepo)

	cleanup := func() { pool.Close() }
	return authSvc, profileSvc, pool, cleanup
}

func TestProfileDB_OwnProfileLifecycle(t *testing.T) {
	authSvc, profileSvc, pool, cleanup := profileTestStack(t)
	defer cleanup()
	ctx := context.Background()

	email := "dbprofile-" + dbSuffix() + "@example.com"
	username := "dbprofile_" + dbSuffix()

	res, err := authSvc.Register(ctx, RegisterInput{
		Email: email, Username: username, Password: "password123",
	}, ClientMeta{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	t.Cleanup(func() { _ = repositories.NewUserRepository(pool).PurgeForTests(ctx, res.User.ID) })

	// Registration guarantees the profile row and defaults the display
	// name to the username.
	profile, err := profileSvc.GetMyProfile(ctx, res.User.ID)
	if err != nil {
		t.Fatalf("GetMyProfile: %v", err)
	}
	if profile.Username != username || profile.DisplayName != username {
		t.Errorf("fresh profile wrong: username=%q display=%q", profile.Username, profile.DisplayName)
	}
	if profile.Bio != nil {
		t.Errorf("fresh bio = %q, want nil", *profile.Bio)
	}
	if profile.Email != email || profile.Role != "USER" || profile.Status != "ACTIVE" {
		t.Errorf("owner account fields wrong: %+v", profile)
	}
	if profile.EmailVerifiedAt != nil {
		t.Error("fresh account must not be email-verified")
	}

	// Partial update: display name only, whitespace-padded.
	time.Sleep(10 * time.Millisecond) // let the trigger's now() advance
	displayName := "  Profile Owner  "
	updated, err := profileSvc.UpdateMyProfile(ctx, res.User.ID, ProfileUpdateInput{DisplayName: &displayName})
	if err != nil {
		t.Fatalf("update display name: %v", err)
	}
	if updated.DisplayName != "Profile Owner" {
		t.Errorf("display name = %q, want trimmed", updated.DisplayName)
	}
	if updated.Bio != nil {
		t.Errorf("bio touched by display-name-only update: %+v", updated.Bio)
	}
	if !updated.UpdatedAt.After(profile.CreatedAt) {
		t.Errorf("updated_at %v did not advance past created_at %v", updated.UpdatedAt, profile.CreatedAt)
	}

	// The update persisted — a fresh read sees the same state.
	reread, err := profileSvc.GetMyProfile(ctx, res.User.ID)
	if err != nil {
		t.Fatalf("reread: %v", err)
	}
	if reread.DisplayName != "Profile Owner" {
		t.Errorf("display name did not persist: %q", reread.DisplayName)
	}

	// Bio with interior newlines: edges trimmed, content preserved.
	bio := "\nLine one\n\nLine two  "
	updated, err = profileSvc.UpdateMyProfile(ctx, res.User.ID, ProfileUpdateInput{Bio: &bio})
	if err != nil {
		t.Fatalf("update bio: %v", err)
	}
	if updated.Bio == nil || *updated.Bio != "Line one\n\nLine two" {
		t.Errorf("bio = %+v, want edge-trimmed with interior newlines", updated.Bio)
	}
	if updated.DisplayName != "Profile Owner" {
		t.Errorf("display name touched by bio-only update: %q", updated.DisplayName)
	}

	// Empty bio clears it.
	empty := ""
	updated, err = profileSvc.UpdateMyProfile(ctx, res.User.ID, ProfileUpdateInput{Bio: &empty})
	if err != nil {
		t.Fatalf("clear bio: %v", err)
	}
	if updated.Bio != nil {
		t.Errorf("bio = %q after clearing, want nil", *updated.Bio)
	}

	// Public lookup sees the updated profile (citext, case-insensitive).
	public, err := profileSvc.GetPublicProfile(ctx, strings.ToUpper(username))
	if err != nil {
		t.Fatalf("public lookup: %v", err)
	}
	if public.UserID != res.User.ID || public.DisplayName != "Profile Owner" {
		t.Errorf("public profile wrong: %+v", public)
	}

	// Oversized display name is rejected by the service, before any SQL.
	oversized := strings.Repeat("x", MaxDisplayNameLength+1)
	_, err = profileSvc.UpdateMyProfile(ctx, res.User.ID, ProfileUpdateInput{DisplayName: &oversized})
	assertAppErr(t, err, 400, "VALIDATION_ERROR")

	// Unknown user, uniformly USER_NOT_FOUND.
	_, err = profileSvc.GetMyProfile(ctx, uuid.New())
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
	_, err = profileSvc.GetPublicProfile(ctx, "ghost_"+dbSuffix())
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

func TestProfileDB_PublicLookupHiddenAccounts(t *testing.T) {
	authSvc, profileSvc, pool, cleanup := profileTestStack(t)
	defer cleanup()
	ctx := context.Background()

	email := "dbhidden-" + dbSuffix() + "@example.com"
	username := "dbhidden_" + dbSuffix()

	res, err := authSvc.Register(ctx, RegisterInput{
		Email: email, Username: username, Password: "password123",
	}, ClientMeta{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	t.Cleanup(func() { _ = repositories.NewUserRepository(pool).PurgeForTests(ctx, res.User.ID) })

	// The account is publicly visible while ACTIVE.
	if _, err := profileSvc.GetPublicProfile(ctx, username); err != nil {
		t.Fatalf("active account must be public: %v", err)
	}

	// Suspension hides the profile — the response is the same generic
	// not-found as any unknown username.
	_, err = pool.Exec(ctx, `UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, res.User.ID)
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}
	_, err = profileSvc.GetPublicProfile(ctx, username)
	assertAppErr(t, err, 404, "USER_NOT_FOUND")

	// So does a ban.
	_, err = pool.Exec(ctx, `UPDATE users SET status = 'BANNED' WHERE id = $1`, res.User.ID)
	if err != nil {
		t.Fatalf("ban: %v", err)
	}
	_, err = profileSvc.GetPublicProfile(ctx, username)
	assertAppErr(t, err, 404, "USER_NOT_FOUND")

	// And so does deletion.
	_, err = pool.Exec(ctx, `UPDATE users SET deleted_at = now() WHERE id = $1`, res.User.ID)
	if err != nil {
		t.Fatalf("soft-delete: %v", err)
	}
	_, err = profileSvc.GetPublicProfile(ctx, username)
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

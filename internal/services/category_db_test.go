package services

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/database"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// These tests run the full category/interest stack over a real database
// (make test-db): the public listing from the seeded taxonomy, and the
// service-validated atomic replacement persisting through the repository.

func categoryTestStack(t *testing.T) (*AuthService, *CategoryService, *pgxpool.Pool, func()) {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping category integration test")
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
	categorySvc := NewCategoryService(repositories.NewCategoryRepository(pool))

	cleanup := func() { pool.Close() }
	return authSvc, categorySvc, pool, cleanup
}

func registerInterestUser(t *testing.T, authSvc *AuthService, pool *pgxpool.Pool, prefix string) uuid.UUID {
	t.Helper()

	res, err := authSvc.Register(context.Background(), RegisterInput{
		Email:    prefix + "-" + dbSuffix() + "@example.com",
		Username: prefix + "_" + dbSuffix(),
		Password: "password123",
	}, ClientMeta{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register %s: %v", prefix, err)
	}
	t.Cleanup(func() { _ = repositories.NewUserRepository(pool).PurgeForTests(context.Background(), res.User.ID) })
	return res.User.ID
}

func TestCategoryDB_InterestLifecycle(t *testing.T) {
	authSvc, categorySvc, pool, cleanup := categoryTestStack(t)
	defer cleanup()
	ctx := context.Background()

	// The public listing serves the seeded taxonomy.
	categories, err := categorySvc.ListCategories(ctx)
	if err != nil {
		t.Fatalf("ListCategories: %v", err)
	}
	bySlug := map[string]string{}
	for _, c := range categories {
		bySlug[c.Slug] = c.ID.String()
	}
	for _, slug := range []string{"music", "gaming", "sports"} {
		if _, ok := bySlug[slug]; !ok {
			t.Fatalf("seeded category %q missing", slug)
		}
	}

	userID := registerInterestUser(t, authSvc, pool, "dbcat")

	// Authenticated empty initial interests.
	interests, err := categorySvc.GetMyInterests(ctx, userID)
	if err != nil {
		t.Fatalf("GetMyInterests: %v", err)
	}
	if len(interests) != 0 {
		t.Fatalf("fresh user interests = %+v, want empty", interests)
	}

	// Valid single-category selection.
	single, err := categorySvc.ReplaceMyInterests(ctx, userID, []string{bySlug["music"]})
	if err != nil {
		t.Fatalf("select single: %v", err)
	}
	if len(single) != 1 || single[0].Slug != "music" {
		t.Errorf("single selection = %+v", single)
	}

	// Persistence: a fresh read sees the same state.
	reread, err := categorySvc.GetMyInterests(ctx, userID)
	if err != nil {
		t.Fatalf("reread: %v", err)
	}
	if len(reread) != 1 || reread[0].Slug != "music" {
		t.Errorf("selection did not persist: %+v", reread)
	}

	// Maximum-size selection with real category IDs (seed provides ten).
	allIDs := make([]string, 0, len(categories))
	for _, c := range categories {
		allIDs = append(allIDs, c.ID.String())
	}
	if len(allIDs) >= MaxInterests {
		maxSet := allIDs[:MaxInterests]
		maxResult, err := categorySvc.ReplaceMyInterests(ctx, userID, maxSet)
		if err != nil {
			t.Fatalf("select max: %v", err)
		}
		if len(maxResult) != MaxInterests {
			t.Errorf("max selection = %d, want %d", len(maxResult), MaxInterests)
		}
	}

	// Replacement semantics: shrinking to a different set removes the old.
	replaced, err := categorySvc.ReplaceMyInterests(ctx, userID, []string{bySlug["gaming"]})
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	if len(replaced) != 1 || replaced[0].Slug != "gaming" {
		t.Errorf("replacement = %+v", replaced)
	}
	reread, err = categorySvc.GetMyInterests(ctx, userID)
	if err != nil {
		t.Fatalf("reread after replace: %v", err)
	}
	if len(reread) != 1 || reread[0].Slug != "gaming" {
		t.Errorf("old interests survived replacement: %+v", reread)
	}

	// --- Invalid sets: each must be rejected AND leave the stored
	// selection (gaming) exactly unchanged. ---
	snapshot := func() []string {
		t.Helper()
		current, err := categorySvc.GetMyInterests(ctx, userID)
		if err != nil {
			t.Fatalf("snapshot: %v", err)
		}
		out := make([]string, 0, len(current))
		for _, c := range current {
			out = append(out, c.Slug)
		}
		return out
	}
	before := snapshot()

	invalidSets := []struct {
		name   string
		input  []string
		status int
		code   string
	}{
		{"empty", []string{}, 400, "VALIDATION_ERROR"},
		{"too many", append(allIDs, uuid.New().String()), 400, "VALIDATION_ERROR"},
		{"malformed uuid", []string{bySlug["gaming"], "not-a-uuid"}, 400, "VALIDATION_ERROR"},
		{"duplicates", []string{bySlug["gaming"], bySlug["gaming"]}, 400, "VALIDATION_ERROR"},
		{"nonexistent", []string{bySlug["gaming"], uuid.New().String()}, 404, "CATEGORY_NOT_FOUND"},
		{"mixed valid and invalid", []string{bySlug["music"], uuid.New().String()}, 404, "CATEGORY_NOT_FOUND"},
	}
	for _, c := range invalidSets {
		_, err := categorySvc.ReplaceMyInterests(ctx, userID, c.input)
		assertAppErr(t, err, c.status, c.code)

		after := snapshot()
		if len(after) != len(before) {
			t.Errorf("%s: stored interests changed: %v -> %v", c.name, before, after)
		}
		for i := range before {
			if before[i] != after[i] {
				t.Errorf("%s: stored interests changed: %v -> %v", c.name, before, after)
			}
		}
	}
}

func TestCategoryDB_UsersAreIsolated(t *testing.T) {
	authSvc, categorySvc, pool, cleanup := categoryTestStack(t)
	defer cleanup()
	ctx := context.Background()

	alice := registerInterestUser(t, authSvc, pool, "isoalice")
	bob := registerInterestUser(t, authSvc, pool, "isobob")

	categories, err := categorySvc.ListCategories(ctx)
	if err != nil {
		t.Fatalf("ListCategories: %v", err)
	}
	if len(categories) < 2 {
		t.Fatal("need at least two categories")
	}
	alicePick, bobPick := categories[0].ID.String(), categories[1].ID.String()

	// Alice selects her set.
	if _, err := categorySvc.ReplaceMyInterests(ctx, alice, []string{alicePick}); err != nil {
		t.Fatalf("alice select: %v", err)
	}
	// Bob selects his.
	if _, err := categorySvc.ReplaceMyInterests(ctx, bob, []string{bobPick}); err != nil {
		t.Fatalf("bob select: %v", err)
	}

	// Each user's read returns only their own selection.
	aliceInterests, err := categorySvc.GetMyInterests(ctx, alice)
	if err != nil {
		t.Fatalf("alice read: %v", err)
	}
	if len(aliceInterests) != 1 || aliceInterests[0].ID.String() != alicePick {
		t.Errorf("alice's interests = %+v", aliceInterests)
	}

	bobInterests, err := categorySvc.GetMyInterests(ctx, bob)
	if err != nil {
		t.Fatalf("bob read: %v", err)
	}
	if len(bobInterests) != 1 || bobInterests[0].ID.String() != bobPick {
		t.Errorf("bob's interests = %+v", bobInterests)
	}

	// A replacement by Alice cannot touch Bob's stored set.
	if _, err := categorySvc.ReplaceMyInterests(ctx, alice, []string{bobPick}); err != nil {
		t.Fatalf("alice replace: %v", err)
	}
	bobInterests, err = categorySvc.GetMyInterests(ctx, bob)
	if err != nil {
		t.Fatalf("bob reread: %v", err)
	}
	if len(bobInterests) != 1 || bobInterests[0].ID.String() != bobPick {
		t.Errorf("alice's replacement leaked into bob's interests: %+v", bobInterests)
	}
}

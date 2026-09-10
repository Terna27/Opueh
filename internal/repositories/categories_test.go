package repositories

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// These tests run against a real database (make test-db) and verify the
// category SQL: the deterministic public listing, the transactional
// replacement semantics, and the rollback guarantee. They use the seeded
// taxonomy read-only and never insert categories, so a shared test
// database stays clean.

// seededCategoryBySlug finds a seeded category by slug (e.g. "music").
func seededCategoryBySlug(t *testing.T, repo *CategoryRepository, ctx context.Context, slug string) uuid.UUID {
	t.Helper()
	categories, err := repo.ListSelectable(ctx)
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	for _, c := range categories {
		if c.Slug == slug {
			return c.ID
		}
	}
	t.Fatalf("seeded category %q not found", slug)
	return uuid.Nil
}

func TestCategoryRepository_ListSelectable(t *testing.T) {
	pool := testPool(t)
	repo := NewCategoryRepository(pool)
	ctx := context.Background()

	first, err := repo.ListSelectable(ctx)
	if err != nil {
		t.Fatalf("ListSelectable: %v", err)
	}

	// The seed migration guarantees these exist.
	seeded := map[string]bool{
		"gaming": false, "music": false, "sports": false, "education": false,
		"entertainment": false, "technology": false, "cooking": false,
		"fitness": false, "travel": false, "news": false,
	}
	for _, c := range first {
		if _, ok := seeded[c.Slug]; ok {
			seeded[c.Slug] = true
		}
	}
	for slug, found := range seeded {
		if !found {
			t.Errorf("seeded category %q missing from listing", slug)
		}
	}

	// Deterministic ordering: by name, and identical across calls.
	for i := 1; i < len(first); i++ {
		if first[i-1].Name >= first[i].Name {
			t.Fatalf("listing not ordered by name: %q >= %q", first[i-1].Name, first[i].Name)
		}
	}
	second, err := repo.ListSelectable(ctx)
	if err != nil {
		t.Fatalf("second ListSelectable: %v", err)
	}
	if len(first) != len(second) {
		t.Fatalf("listing length changed between calls: %d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Fatalf("listing order not deterministic at %d: %s vs %s", i, first[i].ID, second[i].ID)
		}
	}
}

func TestCategoryRepository_ReplaceUserInterests(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	repo := NewCategoryRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	user, err := users.CreateWithProfile(ctx,
		"interests-"+suffix+"@example.com", "interests_"+suffix, "hash", "Interests Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	music := seededCategoryBySlug(t, repo, ctx, "music")
	gaming := seededCategoryBySlug(t, repo, ctx, "gaming")
	sports := seededCategoryBySlug(t, repo, ctx, "sports")

	// A fresh user has no interests — empty slice, not an error.
	initial, err := repo.ListUserInterests(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserInterests: %v", err)
	}
	if len(initial) != 0 {
		t.Fatalf("fresh user has interests: %+v", initial)
	}

	// First selection of two.
	first, err := repo.ReplaceUserInterests(ctx, user.ID, []uuid.UUID{gaming, music})
	if err != nil {
		t.Fatalf("replace #1: %v", err)
	}
	// Ordered by name deterministically: Gaming < Music.
	if len(first) != 2 || first[0].Slug != "gaming" || first[1].Slug != "music" {
		t.Errorf("replace #1 result = %+v", first)
	}

	// It persisted.
	reread, err := repo.ListUserInterests(ctx, user.ID)
	if err != nil {
		t.Fatalf("reread: %v", err)
	}
	if len(reread) != 2 || reread[0].Slug != "gaming" || reread[1].Slug != "music" {
		t.Errorf("reread = %+v", reread)
	}

	// Replacement semantics: a different set entirely replaces the old one.
	second, err := repo.ReplaceUserInterests(ctx, user.ID, []uuid.UUID{sports})
	if err != nil {
		t.Fatalf("replace #2: %v", err)
	}
	if len(second) != 1 || second[0].Slug != "sports" {
		t.Errorf("replace #2 result = %+v", second)
	}
	reread, err = repo.ListUserInterests(ctx, user.ID)
	if err != nil {
		t.Fatalf("reread after replace #2: %v", err)
	}
	if len(reread) != 1 || reread[0].Slug != "sports" {
		t.Errorf("old interests survived replacement: %+v", reread)
	}

	// Replacing with the identical set remains valid (idempotent at the
	// resource-state level).
	same, err := repo.ReplaceUserInterests(ctx, user.ID, []uuid.UUID{sports})
	if err != nil {
		t.Fatalf("idempotent replace: %v", err)
	}
	if len(same) != 1 || same[0].Slug != "sports" {
		t.Errorf("idempotent replace result = %+v", same)
	}

	// A full-size set in which some IDs don't exist must fail the count
	// check wholesale — and leave the previous selection untouched.
	maxSet := []uuid.UUID{music, gaming, sports}
	for i := 3; i < 10; i++ {
		maxSet = append(maxSet, uuid.New()) // valid UUIDs that match no category
	}
	_, err = repo.ReplaceUserInterests(ctx, user.ID, maxSet)
	if !errors.Is(err, ErrCategoryNotFound) {
		t.Fatalf("replacement with nonexistent category IDs: %v, want ErrCategoryNotFound", err)
	}
	reread, err = repo.ListUserInterests(ctx, user.ID)
	if err != nil {
		t.Fatalf("reread after failed replace: %v", err)
	}
	if len(reread) != 1 || reread[0].Slug != "sports" {
		t.Errorf("failed replacement altered stored interests: %+v", reread)
	}

	// Unknown user surfaces ErrNotFound.
	if _, err := repo.ReplaceUserInterests(ctx, uuid.New(), []uuid.UUID{music}); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown user: %v, want ErrNotFound", err)
	}
}

func TestCategoryRepository_ReplaceRollsBackOnInvalidSet(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	repo := NewCategoryRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	user, err := users.CreateWithProfile(ctx,
		"rollback-"+suffix+"@example.com", "rollback_"+suffix, "hash", "Rollback Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	music := seededCategoryBySlug(t, repo, ctx, "music")
	gaming := seededCategoryBySlug(t, repo, ctx, "gaming")
	ghost := uuid.New() // valid UUID, no such category

	// Seed a known state.
	if _, err := repo.ReplaceUserInterests(ctx, user.ID, []uuid.UUID{music, gaming}); err != nil {
		t.Fatalf("seed interests: %v", err)
	}

	// A mixture of valid and invalid IDs must fail as a whole...
	_, err = repo.ReplaceUserInterests(ctx, user.ID, []uuid.UUID{music, ghost, gaming})
	if !errors.Is(err, ErrCategoryNotFound) {
		t.Fatalf("mixed set: %v, want ErrCategoryNotFound", err)
	}

	// ...and leave the original interests exactly unchanged.
	after, err := repo.ListUserInterests(ctx, user.ID)
	if err != nil {
		t.Fatalf("reread after failed replace: %v", err)
	}
	if len(after) != 2 {
		t.Fatalf("original selection altered: %+v", after)
	}
	got := map[uuid.UUID]bool{after[0].ID: true, after[1].ID: true}
	if !got[music] || !got[gaming] {
		t.Errorf("original selection wrong after rollback: %+v", after)
	}
}

func TestCategoryRepository_JoinTableDuplicateConstraint(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	repo := NewCategoryRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	user, err := users.CreateWithProfile(ctx,
		"dupcat-"+suffix+"@example.com", "dupcat_"+suffix, "hash", "Dup Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	music := seededCategoryBySlug(t, repo, ctx, "music")

	// Insert the same (user, category) pair twice directly: the composite
	// PK must reject it — the database-level backstop of the application's
	// duplicate rejection.
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_categories (user_id, category_id) VALUES ($1, $2)`,
		user.ID, music); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_categories (user_id, category_id) VALUES ($1, $2)`,
		user.ID, music); err == nil {
		t.Error("duplicate (user_id, category_id) pair must be rejected by the composite PK")
	}
}

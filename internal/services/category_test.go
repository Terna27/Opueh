package services

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// fakeCategoryStore is an in-memory CategoryStore. It mirrors the
// repository contract and records replace calls so tests can assert what
// the service asked the store to write.
type fakeCategoryStore struct {
	selectable []models.Category

	// replaceErr, when set, is returned from ReplaceUserInterests.
	replaceErr error

	replaceCalls     int
	replaceFor       []uuid.UUID
	replaceIDSets    [][]uuid.UUID
	currentSelection map[uuid.UUID][]uuid.UUID
}

func strPtr(s string) *string { return &s }

func testCategories() []models.Category {
	return []models.Category{
		{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), Slug: "music", Name: "Music", Description: strPtr("Performances")},
		{ID: uuid.MustParse("22222222-2222-2222-2222-222222222222"), Slug: "gaming", Name: "Gaming", Description: nil},
		{ID: uuid.MustParse("33333333-3333-3333-3333-333333333333"), Slug: "sports", Name: "Sports", Description: nil},
	}
}

func (f *fakeCategoryStore) ListSelectable(ctx context.Context) ([]models.Category, error) {
	return f.selectable, nil
}

func (f *fakeCategoryStore) ListUserInterests(ctx context.Context, userID uuid.UUID) ([]models.Category, error) {
	ids := f.currentSelection[userID]
	var out []models.Category
	for _, c := range f.selectable {
		for _, id := range ids {
			if c.ID == id {
				out = append(out, c)
			}
		}
	}
	return out, nil
}

func (f *fakeCategoryStore) ReplaceUserInterests(ctx context.Context, userID uuid.UUID, categoryIDs []uuid.UUID) ([]models.Category, error) {
	f.replaceCalls++
	f.replaceFor = append(f.replaceFor, userID)
	f.replaceIDSets = append(f.replaceIDSets, categoryIDs)
	if f.replaceErr != nil {
		return nil, f.replaceErr
	}
	f.currentSelection[userID] = categoryIDs
	return f.ListUserInterests(ctx, userID)
}

func TestCategoryService_ListCategories(t *testing.T) {
	cats := testCategories()
	svc := NewCategoryService(&fakeCategoryStore{selectable: cats})

	got, err := svc.ListCategories(context.Background())
	if err != nil {
		t.Fatalf("ListCategories: %v", err)
	}
	if len(got) != 3 || got[0].Slug != "music" {
		t.Errorf("categories = %+v", got)
	}
}

func TestCategoryService_GetMyInterests_EmptyInitially(t *testing.T) {
	svc := NewCategoryService(&fakeCategoryStore{selectable: testCategories()})

	got, err := svc.GetMyInterests(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("GetMyInterests: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("fresh user interests = %+v, want empty", got)
	}
}

func TestCategoryService_ReplaceMyInterests(t *testing.T) {
	music := "11111111-1111-1111-1111-111111111111"
	gaming := "22222222-2222-2222-2222-222222222222"

	cases := []struct {
		name   string
		input  []string
		wantFn func(t *testing.T, store *fakeCategoryStore, got []models.Category)
	}{
		{
			name:  "single category",
			input: []string{music},
			wantFn: func(t *testing.T, store *fakeCategoryStore, got []models.Category) {
				if len(got) != 1 || got[0].Slug != "music" {
					t.Errorf("interests = %+v", got)
				}
			},
		},
		{
			name:  "multiple categories",
			input: []string{music, gaming},
			wantFn: func(t *testing.T, store *fakeCategoryStore, got []models.Category) {
				if len(got) != 2 {
					t.Fatalf("interests = %d, want 2", len(got))
				}
			},
		},
		{
			name:  "maximum allowed categories",
			input: maxInterestIDs(t, music),
			wantFn: func(t *testing.T, store *fakeCategoryStore, got []models.Category) {
				if len(got) != MaxInterests {
					t.Errorf("interests = %d, want %d", len(got), MaxInterests)
				}
			},
		},
	}

	for _, c := range cases {
		selectable := testCategories()

		existing := make(map[uuid.UUID]struct{}, len(selectable))
		for _, category := range selectable {
			existing[category.ID] = struct{}{}
		}

		for i, rawID := range c.input {
			id := uuid.MustParse(rawID)
			if _, ok := existing[id]; ok {
				continue
			}

			selectable = append(selectable, models.Category{
				ID:   id,
				Slug: fmt.Sprintf("test-category-%d", i),
				Name: fmt.Sprintf("Test Category %d", i),
			})
			existing[id] = struct{}{}
		}

		store := &fakeCategoryStore{
			selectable:       selectable,
			currentSelection: map[uuid.UUID][]uuid.UUID{},
		}
		svc := NewCategoryService(store)
		userID := uuid.New()

		got, err := svc.ReplaceMyInterests(context.Background(), userID, c.input)
		if err != nil {
			t.Fatalf("%s: ReplaceMyInterests: %v", c.name, err)
		}
		if store.replaceCalls != 1 || store.replaceFor[0] != userID {
			t.Errorf("%s: store call = %+v", c.name, store.replaceFor)
		}
		if len(store.replaceIDSets[0]) != len(c.input) {
			t.Errorf("%s: store received %d ids, want %d", c.name, len(store.replaceIDSets[0]), len(c.input))
		}
		c.wantFn(t, store, got)
	}
}

// maxInterestIDs builds MaxInterests unique valid UUID strings (the first
// one from the fixture, the rest synthetic).
func maxInterestIDs(t *testing.T, first string) []string {
	t.Helper()
	ids := []string{first}
	for i := 1; i < MaxInterests; i++ {
		ids = append(ids, uuid.New().String())
	}
	return ids
}

func TestCategoryService_ReplaceMyInterests_Rejections(t *testing.T) {
	music := "11111111-1111-1111-1111-111111111111"
	gaming := "22222222-2222-2222-2222-222222222222"

	cases := []struct {
		name  string
		input []string
	}{
		{"empty list", []string{}},
		{"nil list", nil},
		{"too many", func() []string {
			ids := maxInterestIDs(t, music)
			return append(ids, uuid.New().String())
		}()},
		{"malformed uuid", []string{music, "not-a-uuid"}},
		{"duplicate ids", []string{music, gaming, music}},
		{"duplicate single id", []string{music, music}},
	}
	for _, c := range cases {
		store := &fakeCategoryStore{selectable: testCategories(), currentSelection: map[uuid.UUID][]uuid.UUID{}}
		svc := NewCategoryService(store)

		_, err := svc.ReplaceMyInterests(context.Background(), uuid.New(), c.input)
		assertAppErr(t, err, 400, "VALIDATION_ERROR")

		if store.replaceCalls != 0 {
			t.Errorf("%s: store must not be touched, got %d calls", c.name, store.replaceCalls)
		}
	}
}

func TestCategoryService_ReplaceMyInterests_CategoryNotFound(t *testing.T) {
	store := &fakeCategoryStore{
		selectable:       testCategories(),
		currentSelection: map[uuid.UUID][]uuid.UUID{},
		replaceErr:       fmt.Errorf("%w: requested 2 categories, 1 exist", repositories.ErrCategoryNotFound),
	}
	svc := NewCategoryService(store)

	_, err := svc.ReplaceMyInterests(context.Background(), uuid.New(),
		[]string{"11111111-1111-1111-1111-111111111111", uuid.New().String()})
	assertAppErr(t, err, 404, "CATEGORY_NOT_FOUND")
}

func TestCategoryService_ReplaceMyInterests_UserNotFound(t *testing.T) {
	store := &fakeCategoryStore{
		selectable:       testCategories(),
		currentSelection: map[uuid.UUID][]uuid.UUID{},
		replaceErr:       fmt.Errorf("%w: user %s", repositories.ErrNotFound, uuid.New()),
	}
	svc := NewCategoryService(store)

	_, err := svc.ReplaceMyInterests(context.Background(), uuid.New(),
		[]string{"11111111-1111-1111-1111-111111111111"})
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

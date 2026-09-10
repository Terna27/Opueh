package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/models"
)

// stubCategoryProvider records what the handler derived from server-side
// state, so tests can prove the write targets the authenticated user only.
type stubCategoryProvider struct {
	listResult []models.Category
	listErr    error

	interestsUserID uuid.UUID
	interests       []models.Category

	replaceUserID uuid.UUID
	replaceIDs    []string
	replaceCalls  int
	replaceResult []models.Category
	replaceErr    error
}

func (s *stubCategoryProvider) ListCategories(ctx context.Context) ([]models.Category, error) {
	return s.listResult, s.listErr
}

func (s *stubCategoryProvider) GetMyInterests(ctx context.Context, userID uuid.UUID) ([]models.Category, error) {
	s.interestsUserID = userID
	return s.interests, nil
}

func (s *stubCategoryProvider) ReplaceMyInterests(ctx context.Context, userID uuid.UUID, categoryIDs []string) ([]models.Category, error) {
	s.replaceCalls++
	s.replaceUserID = userID
	s.replaceIDs = categoryIDs
	if s.replaceErr != nil {
		return nil, s.replaceErr
	}
	return s.replaceResult, nil
}

func TestCategoryHandler_ListPublicRequiresNoAuth(t *testing.T) {
	h := NewCategoryHandler(&stubCategoryProvider{
		listResult: []models.Category{
			{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), Slug: "music", Name: "Music", Description: nil},
		},
	})

	// Direct call with no auth middleware at all — the endpoint is public.
	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api/v1/categories", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp struct {
		Categories []struct {
			ID   string  `json:"id"`
			Name string  `json:"name"`
			Slug string  `json:"slug"`
			Desc *string `json:"description"`
		} `json:"categories"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(resp.Categories) != 1 || resp.Categories[0].Slug != "music" {
		t.Errorf("categories = %+v", resp.Categories)
	}
}

func TestCategoryHandler_ListEmptyIsArray(t *testing.T) {
	h := NewCategoryHandler(&stubCategoryProvider{})

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api/v1/categories", nil))

	if !strings.Contains(rec.Body.String(), `"categories":[]`) {
		t.Errorf("empty listing must serialize as [], got %s", rec.Body.String())
	}
}

func TestCategoryHandler_MyInterests_RequiresAuth(t *testing.T) {
	h := NewCategoryHandler(&stubCategoryProvider{})

	rec := httptest.NewRecorder()
	h.MyInterests(rec, httptest.NewRequest(http.MethodGet, "/api/v1/me/interests", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(rec.Body.String(), "UNAUTHENTICATED") {
		t.Errorf("expected UNAUTHENTICATED, got %s", rec.Body.String())
	}
}

func TestCategoryHandler_MyInterests_EmptyAndFilled(t *testing.T) {
	empty := NewCategoryHandler(&stubCategoryProvider{})
	user := &models.AuthenticatedUser{UserID: uuid.New()}

	rec := serveAuthed(t, user, empty.MyInterests, httptest.NewRequest(http.MethodGet, "/api/v1/me/interests", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"interests":[]`) {
		t.Errorf("empty interests must serialize as [], got %s", rec.Body.String())
	}

	filled := NewCategoryHandler(&stubCategoryProvider{
		interests: []models.Category{
			{ID: uuid.MustParse("22222222-2222-2222-2222-222222222222"), Slug: "gaming", Name: "Gaming"},
		},
	})
	rec = serveAuthed(t, user, filled.MyInterests, httptest.NewRequest(http.MethodGet, "/api/v1/me/interests", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"slug":"gaming"`) {
		t.Errorf("filled interests wrong: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCategoryHandler_ReplaceInterests_RequiresAuth(t *testing.T) {
	h := NewCategoryHandler(&stubCategoryProvider{})

	rec := httptest.NewRecorder()
	h.ReplaceInterests(rec, httptest.NewRequest(http.MethodPut, "/api/v1/me/interests",
		strings.NewReader(`{"category_ids":["11111111-1111-1111-1111-111111111111"]}`)))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestCategoryHandler_ReplaceInterests_Success(t *testing.T) {
	provider := &stubCategoryProvider{
		replaceResult: []models.Category{
			{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), Slug: "music", Name: "Music"},
		},
	}
	h := NewCategoryHandler(provider)

	// The authenticated user. The body carries no identity of its own.
	user := &models.AuthenticatedUser{UserID: uuid.MustParse("99999999-9999-9999-9999-999999999999")}

	req := httptest.NewRequest(http.MethodPut, "/api/v1/me/interests",
		strings.NewReader(`{"category_ids":["11111111-1111-1111-1111-111111111111"]}`))
	rec := serveAuthed(t, user, h.ReplaceInterests, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	// The write targets EXCLUSIVELY the authenticated identity.
	if provider.replaceUserID != user.UserID {
		t.Errorf("replaced for %s, want the context user %s", provider.replaceUserID, user.UserID)
	}
	if len(provider.replaceIDs) != 1 || provider.replaceIDs[0] != "11111111-1111-1111-1111-111111111111" {
		t.Errorf("replace input = %+v", provider.replaceIDs)
	}
	if !strings.Contains(rec.Body.String(), `"interests"`) {
		t.Errorf("response missing interests: %s", rec.Body.String())
	}
}

func TestCategoryHandler_ReplaceInterests_CannotTargetAnotherUser(t *testing.T) {
	provider := &stubCategoryProvider{}
	h := NewCategoryHandler(provider)
	user := &models.AuthenticatedUser{UserID: uuid.MustParse("99999999-9999-9999-9999-999999999999")}

	// Any attempt to smuggle a target identity into the body is rejected by
	// the strict decoder before the service is ever called.
	req := httptest.NewRequest(http.MethodPut, "/api/v1/me/interests",
		strings.NewReader(`{"category_ids":["11111111-1111-1111-1111-111111111111"],"user_id":"88888888-8888-8888-8888-888888888888"}`))
	rec := serveAuthed(t, user, h.ReplaceInterests, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("expected INVALID_JSON, got %s", rec.Body.String())
	}
	if provider.replaceCalls != 0 {
		t.Errorf("service must not be called, got %d calls", provider.replaceCalls)
	}
}

func TestCategoryHandler_ReplaceInterests_InputRejections(t *testing.T) {
	valid := "11111111-1111-1111-1111-111111111111"

	cases := []struct {
		name string
		body string
		want string
	}{
		{"empty body", ``, "INVALID_JSON"},
		{"malformed json", `{`, "INVALID_JSON"},
		{"null body", `null`, "VALIDATION_ERROR"},
		{"missing category_ids", `{}`, "VALIDATION_ERROR"},
		{"null category_ids", `{"category_ids":null}`, "VALIDATION_ERROR"},
		{"empty category_ids", `{"category_ids":[]}`, "VALIDATION_ERROR"},
		{"too many category_ids", `{"category_ids":[` + strings.Repeat(`"`+valid+`",`, 10) + `"22222222-2222-2222-2222-222222222222"]}`, "VALIDATION_ERROR"},
		{"unknown field", `{"category_ids":["` + valid + `"],"categories":["x"]}`, "INVALID_JSON"},
	}
	for _, c := range cases {
		provider := &stubCategoryProvider{}
		h := NewCategoryHandler(provider)
		user := &models.AuthenticatedUser{UserID: uuid.New()}

		req := httptest.NewRequest(http.MethodPut, "/api/v1/me/interests", strings.NewReader(c.body))
		rec := serveAuthed(t, user, h.ReplaceInterests, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want %d; body: %s", c.name, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s: expected %s, got %s", c.name, c.want, rec.Body.String())
		}
		if provider.replaceCalls != 0 {
			t.Errorf("%s: service must not be called, got %d calls", c.name, provider.replaceCalls)
		}
	}
}

func TestCategoryHandler_ReplaceInterests_ServiceErrorsPassThrough(t *testing.T) {
	notFound := NewCategoryHandler(&stubCategoryProvider{
		replaceErr: apperr.New(http.StatusNotFound, "CATEGORY_NOT_FOUND", "One or more categories do not exist"),
	})
	user := &models.AuthenticatedUser{UserID: uuid.New()}

	req := httptest.NewRequest(http.MethodPut, "/api/v1/me/interests",
		strings.NewReader(`{"category_ids":["11111111-1111-1111-1111-111111111111"]}`))
	rec := serveAuthed(t, user, notFound.ReplaceInterests, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "CATEGORY_NOT_FOUND") {
		t.Errorf("expected CATEGORY_NOT_FOUND, got %s", rec.Body.String())
	}
}

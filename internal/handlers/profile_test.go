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
	"github.com/Tena-byte/opueh/internal/services"
)

// stubProfileProvider records what the handler derived from server-side
// state, so tests can prove the update target comes from the auth context
// alone.
type stubProfileProvider struct {
	profile *models.Profile
	getErr  error

	updateUserID  uuid.UUID
	updateInput   services.ProfileUpdateInput
	updateCalls   int
	updateErr     error
	updateProfile *models.Profile

	publicUsername string
	publicErr      error
}

func (s *stubProfileProvider) GetMyProfile(ctx context.Context, userID uuid.UUID) (*models.Profile, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	return s.profile, nil
}

func (s *stubProfileProvider) UpdateMyProfile(ctx context.Context, userID uuid.UUID, in services.ProfileUpdateInput) (*models.Profile, error) {
	s.updateCalls++
	s.updateUserID = userID
	s.updateInput = in
	if s.updateErr != nil {
		return nil, s.updateErr
	}
	return s.updateProfile, nil
}

func (s *stubProfileProvider) GetPublicProfile(ctx context.Context, username string) (*models.Profile, error) {
	s.publicUsername = username
	if s.publicErr != nil {
		return nil, s.publicErr
	}
	return s.profile, nil
}

func testProfile() *models.Profile {
	bio := "I make videos."
	return &models.Profile{
		UserID:      uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Username:    "jane_doe",
		DisplayName: "Jane Doe",
		Bio:         &bio,
		Email:       "jane@example.com",
		Role:        "USER",
		Status:      "ACTIVE",
	}
}

func TestProfileHandler_MyProfile_RequiresAuth(t *testing.T) {
	h := NewProfileHandler(&stubProfileProvider{})

	rec := httptest.NewRecorder()
	h.MyProfile(rec, httptest.NewRequest(http.MethodGet, "/api/v1/me/profile", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(rec.Body.String(), "UNAUTHENTICATED") {
		t.Errorf("expected UNAUTHENTICATED, got %s", rec.Body.String())
	}
}

func TestProfileHandler_MyProfile_ReturnsOwnerView(t *testing.T) {
	h := NewProfileHandler(&stubProfileProvider{profile: testProfile()})
	user := &models.AuthenticatedUser{UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111")}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/profile", nil)
	rec := serveAuthed(t, user, h.MyProfile, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp struct {
		ID            string `json:"id"`
		Username      string `json:"username"`
		DisplayName   string `json:"display_name"`
		Bio           string `json:"bio"`
		Email         string `json:"email"`
		Role          string `json:"role"`
		EmailVerified bool   `json:"email_verified"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.ID != "11111111-1111-1111-1111-111111111111" || resp.Username != "jane_doe" {
		t.Errorf("identity fields wrong: %+v", resp)
	}
	if resp.Email != "jane@example.com" {
		t.Errorf("owner view must include email, got %q", resp.Email)
	}
	if resp.Bio != "I make videos." {
		t.Errorf("bio = %q", resp.Bio)
	}

	// The owner view is still secret-free.
	body := rec.Body.String()
	for _, secret := range []string{"password", "hash", "token", "session", "deleted_at", "status"} {
		if strings.Contains(strings.ToLower(body), secret) {
			t.Errorf("owner response leaks %q: %s", secret, body)
		}
	}
}

func TestProfileHandler_MyProfile_ErrorPassesThrough(t *testing.T) {
	h := NewProfileHandler(&stubProfileProvider{
		getErr: apperr.New(http.StatusNotFound, "USER_NOT_FOUND", "User not found"),
	})
	user := &models.AuthenticatedUser{UserID: uuid.New()}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/profile", nil)
	rec := serveAuthed(t, user, h.MyProfile, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestProfileHandler_UpdateMyProfile_RequiresAuth(t *testing.T) {
	h := NewProfileHandler(&stubProfileProvider{})

	rec := httptest.NewRecorder()
	h.UpdateMyProfile(rec, httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", strings.NewReader(`{"display_name":"X"}`)))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestProfileHandler_UpdateMyProfile_Success(t *testing.T) {
	provider := &stubProfileProvider{updateProfile: testProfile()}
	h := NewProfileHandler(provider)

	// The authenticated user. The body deliberately contains no identity of
	// its own — there is nothing to tamper with.
	user := &models.AuthenticatedUser{UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111")}

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile",
		strings.NewReader(`{"display_name":"Jane Updated","bio":"New bio"}`))
	rec := serveAuthed(t, user, h.UpdateMyProfile, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if provider.updateCalls != 1 {
		t.Fatalf("update calls = %d, want 1", provider.updateCalls)
	}
	// The update target is EXCLUSIVELY the authenticated identity.
	if provider.updateUserID != user.UserID {
		t.Errorf("updated user %s, want the context user %s", provider.updateUserID, user.UserID)
	}
	if provider.updateInput.DisplayName == nil || *provider.updateInput.DisplayName != "Jane Updated" {
		t.Errorf("display name input = %+v", provider.updateInput.DisplayName)
	}
	if provider.updateInput.Bio == nil || *provider.updateInput.Bio != "New bio" {
		t.Errorf("bio input = %+v", provider.updateInput.Bio)
	}
}

func TestProfileHandler_UpdateMyProfile_CannotTargetAnotherUser(t *testing.T) {
	provider := &stubProfileProvider{updateProfile: testProfile()}
	h := NewProfileHandler(provider)

	// Even if a client tries to smuggle a target identity, the strict
	// decoder rejects any field the endpoint does not define.
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile",
		strings.NewReader(`{"display_name":"X","user_id":"22222222-2222-2222-2222-222222222222"}`))
	user := &models.AuthenticatedUser{UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111")}
	rec := serveAuthed(t, user, h.UpdateMyProfile, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("expected INVALID_JSON, got %s", rec.Body.String())
	}
	if provider.updateCalls != 0 {
		t.Errorf("service must not be called, got %d calls", provider.updateCalls)
	}
}

func TestProfileHandler_UpdateMyProfile_EmptyPatchRejected(t *testing.T) {
	provider := &stubProfileProvider{updateProfile: testProfile()}
	h := NewProfileHandler(provider)
	user := &models.AuthenticatedUser{UserID: uuid.New()}

	cases := []struct {
		name string
		body string
		want string
	}{
		{"empty object", `{}`, "VALIDATION_ERROR"},
		{"empty body", ``, "INVALID_JSON"},
		{"null body", `null`, "VALIDATION_ERROR"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", strings.NewReader(c.body))
		rec := serveAuthed(t, user, h.UpdateMyProfile, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want %d; body: %s", c.name, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s: expected %s, got %s", c.name, c.want, rec.Body.String())
		}
	}
	if provider.updateCalls != 0 {
		t.Errorf("service must not be called, got %d calls", provider.updateCalls)
	}
}

func TestProfileHandler_UpdateMyProfile_UnknownFieldRejected(t *testing.T) {
	provider := &stubProfileProvider{updateProfile: testProfile()}
	h := NewProfileHandler(provider)
	user := &models.AuthenticatedUser{UserID: uuid.New()}

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile",
		strings.NewReader(`{"display_name":"X","avatar_url":"https://evil.example/x.png"}`))
	rec := serveAuthed(t, user, h.UpdateMyProfile, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("expected INVALID_JSON, got %s", rec.Body.String())
	}
	if provider.updateCalls != 0 {
		t.Errorf("service must not be called, got %d calls", provider.updateCalls)
	}
}

func TestProfileHandler_UpdateMyProfile_OversizedFieldsRejectedAtBoundary(t *testing.T) {
	provider := &stubProfileProvider{updateProfile: testProfile()}
	h := NewProfileHandler(provider)
	user := &models.AuthenticatedUser{UserID: uuid.New()}

	cases := map[string]string{
		"display_name": `{"display_name":"` + strings.Repeat("x", 51) + `"}`,
		"bio":          `{"bio":"` + strings.Repeat("x", 501) + `"}`,
	}
	for name, body := range cases {
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", strings.NewReader(body))
		rec := serveAuthed(t, user, h.UpdateMyProfile, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want %d", name, rec.Code, http.StatusBadRequest)
		}
		if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
			t.Errorf("%s: expected VALIDATION_ERROR, got %s", name, rec.Body.String())
		}
	}
	if provider.updateCalls != 0 {
		t.Errorf("service must not be called, got %d calls", provider.updateCalls)
	}
}

func TestProfileHandler_PublicProfile_ReturnsPublicShapeOnly(t *testing.T) {
	provider := &stubProfileProvider{profile: testProfile()}
	h := NewProfileHandler(provider)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/jane_doe", nil)
	addChiParam(req, "username", "jane_doe")
	rec := httptest.NewRecorder()
	h.PublicProfile(rec, req) // no auth middleware: the endpoint is public

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if provider.publicUsername != "jane_doe" {
		t.Errorf("looked up %q, want the path username", provider.publicUsername)
	}

	// Whitelist assertion: every top-level key must be in the public set.
	var resp map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	allowed := map[string]bool{"id": true, "username": true, "display_name": true, "bio": true, "created_at": true}
	for key := range resp {
		if !allowed[key] {
			t.Errorf("public response contains non-public key %q: %s", key, rec.Body.String())
		}
	}

	// And explicitly: no email, no account state, no security material.
	body := strings.ToLower(rec.Body.String())
	for _, leaked := range []string{"email", "password", "hash", "token", "session", "status", "role", "verified", "deleted"} {
		if strings.Contains(body, leaked) {
			t.Errorf("public response leaks %q: %s", leaked, body)
		}
	}
}

func TestProfileHandler_PublicProfile_NotFound(t *testing.T) {
	h := NewProfileHandler(&stubProfileProvider{
		publicErr: apperr.New(http.StatusNotFound, "USER_NOT_FOUND", "User not found"),
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/ghost_user", nil)
	addChiParam(req, "username", "ghost_user")
	rec := httptest.NewRecorder()
	h.PublicProfile(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "USER_NOT_FOUND") {
		t.Errorf("expected USER_NOT_FOUND, got %s", rec.Body.String())
	}
}

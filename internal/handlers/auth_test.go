package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/services"
)

// stubAuthProvider returns canned results so handler behavior (parsing,
// validation, status codes, serialization) is tested in isolation.
type stubAuthProvider struct {
	registerResult *services.AuthResult
	registerErr    error

	loginResult *services.AuthResult
	loginErr    error

	refreshResult *services.AuthResult
	refreshErr    error

	logoutErr error
}

func (s *stubAuthProvider) Register(ctx context.Context, in services.RegisterInput, meta services.ClientMeta) (*services.AuthResult, error) {
	return s.registerResult, s.registerErr
}

func (s *stubAuthProvider) Login(ctx context.Context, in services.LoginInput, meta services.ClientMeta) (*services.AuthResult, error) {
	return s.loginResult, s.loginErr
}

func (s *stubAuthProvider) Refresh(ctx context.Context, refreshToken string, meta services.ClientMeta) (*services.AuthResult, error) {
	return s.refreshResult, s.refreshErr
}

func (s *stubAuthProvider) Logout(ctx context.Context, sessionID uuid.UUID) error {
	return s.logoutErr
}

func stubResult() *services.AuthResult {
	return &services.AuthResult{
		User: &models.User{
			ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			Email:       "jane@example.com",
			Username:    "jane_doe",
			DisplayName: "Jane Doe",
			Role:        "USER",
			Status:      "ACTIVE",
			CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		AccessToken:  "access-token-value",
		TokenType:    "Bearer",
		ExpiresIn:    900,
		RefreshToken: "rt_refresh-token-value",
	}
}

func TestRegisterHandler_Success(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{registerResult: stubResult()})

	body := `{"email":"jane@example.com","username":"jane_doe","password":"password123","display_name":"Jane Doe"}`
	rec := httptest.NewRecorder()
	h.Register(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body)))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var resp struct {
		User struct {
			Email string `json:"email"`
		} `json:"user"`
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	if resp.User.Email != "jane@example.com" {
		t.Errorf("user.email = %q", resp.User.Email)
	}
	if resp.AccessToken != "access-token-value" || resp.RefreshToken != "rt_refresh-token-value" {
		t.Errorf("tokens not serialized: %+v", resp)
	}
	if resp.TokenType != "Bearer" || resp.ExpiresIn != 900 {
		t.Errorf("token metadata wrong: %+v", resp)
	}
}

func TestRegisterHandler_InvalidJSON(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{})

	rec := httptest.NewRecorder()
	h.Register(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader("not json")))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("expected INVALID_JSON, got %s", rec.Body.String())
	}
}

func TestRegisterHandler_UnknownFieldRejected(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{})

	body := `{"email":"jane@example.com","username":"jane_doe","password":"password123","role":"ADMIN"}`
	rec := httptest.NewRecorder()
	h.Register(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body)))

	// A client trying to self-assign a role must be rejected at the door.
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "INVALID_JSON") {
		t.Errorf("expected INVALID_JSON, got %s", rec.Body.String())
	}
}

func TestRegisterHandler_ValidationErrors(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{})

	cases := []struct {
		name string
		body string
		want string
	}{
		{"missing email", `{"username":"jane_doe","password":"password123"}`, "email"},
		{"bad email", `{"email":"nope","username":"jane_doe","password":"password123"}`, "email"},
		{"short password", `{"email":"jane@example.com","username":"jane_doe","password":"short"}`, "password"},
		{"bad username", `{"email":"jane@example.com","username":"a","password":"password123"}`, "username"},
	}

	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.Register(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(c.body)))

		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want %d", c.name, rec.Code, http.StatusBadRequest)
		}
		if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
			t.Errorf("%s: expected VALIDATION_ERROR, got %s", c.name, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s: message should mention %q, got %s", c.name, c.want, rec.Body.String())
		}
	}
}

func TestRegisterHandler_ServiceErrorPassesThrough(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{
		registerErr: apperr.New(http.StatusConflict, "EMAIL_ALREADY_EXISTS", "An account with this email already exists"),
	})

	body := `{"email":"jane@example.com","username":"jane_doe","password":"password123"}`
	rec := httptest.NewRecorder()
	h.Register(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body)))

	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusConflict)
	}
	if !strings.Contains(rec.Body.String(), "EMAIL_ALREADY_EXISTS") {
		t.Errorf("expected EMAIL_ALREADY_EXISTS, got %s", rec.Body.String())
	}
}

func TestLoginHandler_Success(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{loginResult: stubResult()})

	body := `{"identifier":"jane@example.com","password":"password123"}`
	rec := httptest.NewRecorder()
	h.Login(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body)))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestLoginHandler_MissingFields(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{})

	rec := httptest.NewRecorder()
	h.Login(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{}`)))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("expected VALIDATION_ERROR, got %s", rec.Body.String())
	}
}

func TestRefreshHandler_RequiresToken(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{})

	rec := httptest.NewRecorder()
	h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", strings.NewReader(`{}`)))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("expected VALIDATION_ERROR, got %s", rec.Body.String())
	}
}

func TestRefreshHandler_Success(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{refreshResult: stubResult()})

	rec := httptest.NewRecorder()
	h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh",
		strings.NewReader(`{"refresh_token":"rt_some-token"}`)))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestLogoutHandler_NoContent(t *testing.T) {
	h := NewAuthHandler(&stubAuthProvider{})

	// Wrap with RequireAuth using a stub authenticator so the context
	// carries the authenticated user exactly as it does in production.
	user := &models.AuthenticatedUser{
		UserID:    uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		SessionID: uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		Role:      "USER",
	}
	handler := middleware.RequireAuth(stubAuthForHandlers{user: user})(http.HandlerFunc(h.Logout))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d; body: %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
}

func TestMeHandler_ReturnsUser(t *testing.T) {
	h := NewMeHandler(stubMeProvider{
		user: &models.User{
			ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			Email:       "jane@example.com",
			Username:    "jane_doe",
			DisplayName: "Jane Doe",
			Role:        "USER",
			Status:      "ACTIVE",
			CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		},
	})

	user := &models.AuthenticatedUser{UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111")}
	handler := middleware.RequireAuth(stubAuthForHandlers{user: user})(http.HandlerFunc(h.Me))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp struct {
		Email    string `json:"email"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.Email != "jane@example.com" || resp.Username != "jane_doe" {
		t.Errorf("unexpected user payload: %s", rec.Body.String())
	}
}

// stubAuthForHandlers satisfies middleware.Authenticator.
type stubAuthForHandlers struct {
	user *models.AuthenticatedUser
}

func (s stubAuthForHandlers) Authenticate(ctx context.Context, token string) (*models.AuthenticatedUser, error) {
	return s.user, nil
}

type stubMeProvider struct {
	user *models.User
	err  error
}

func (s stubMeProvider) GetUser(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	return s.user, s.err
}

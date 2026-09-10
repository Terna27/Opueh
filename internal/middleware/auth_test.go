package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/models"
)

type stubAuthenticator struct {
	user *models.AuthenticatedUser
	err  error
}

func (s stubAuthenticator) Authenticate(ctx context.Context, token string) (*models.AuthenticatedUser, error) {
	return s.user, s.err
}

func TestRequireAuth_MissingHeader(t *testing.T) {
	handler := RequireAuth(stubAuthenticator{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("unauthenticated request reached the handler")
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	assertErrCode(t, rec, "UNAUTHENTICATED")
}

func TestRequireAuth_WrongScheme(t *testing.T) {
	handler := RequireAuth(stubAuthenticator{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("unauthenticated request reached the handler")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	assertErrCode(t, rec, "UNAUTHENTICATED")
}

func TestRequireAuth_BearerCaseInsensitive(t *testing.T) {
	user := &models.AuthenticatedUser{}
	var seen *models.AuthenticatedUser

	handler := RequireAuth(stubAuthenticator{user: user})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = UserFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "bearer some-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if seen != user {
		t.Error("authenticated user not propagated to handler context")
	}
}

func TestRequireAuth_AuthenticatorRejects(t *testing.T) {
	handler := RequireAuth(stubAuthenticator{
		err: apperr.New(http.StatusUnauthorized, "INVALID_TOKEN", "Invalid or expired access token"),
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("request with an invalid token reached the handler")
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	assertErrCode(t, rec, "INVALID_TOKEN")
}

func TestUserFromContext_NilWithoutAuth(t *testing.T) {
	if got := UserFromContext(context.Background()); got != nil {
		t.Errorf("expected nil user, got %+v", got)
	}
}

func assertErrCode(t *testing.T, rec *httptest.ResponseRecorder, code string) {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON error body: %v (%s)", err, rec.Body.String())
	}
	if body.Error.Code != code {
		t.Errorf("code = %q, want %q", body.Error.Code, code)
	}
}

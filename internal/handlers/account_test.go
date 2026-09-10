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
	"github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/services"
)

type stubAccountProvider struct {
	requestVerificationErr error
	verifyErr              error
	forgotErr              error
	resetErr               error

	forgotEmails []string
}

func (s *stubAccountProvider) RequestEmailVerification(ctx context.Context, userID uuid.UUID) error {
	return s.requestVerificationErr
}

func (s *stubAccountProvider) VerifyEmail(ctx context.Context, token string) error {
	return s.verifyErr
}

func (s *stubAccountProvider) RequestPasswordReset(ctx context.Context, email string, meta services.ClientMeta) error {
	s.forgotEmails = append(s.forgotEmails, email)
	return s.forgotErr
}

func (s *stubAccountProvider) ResetPassword(ctx context.Context, token, newPassword string, meta services.ClientMeta) error {
	return s.resetErr
}

func TestRequestEmailVerificationHandler_RequiresAuth(t *testing.T) {
	h := NewAccountHandler(&stubAccountProvider{})

	rec := httptest.NewRecorder()
	h.RequestEmailVerification(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/verify/request", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestRequestEmailVerificationHandler_Success(t *testing.T) {
	h := NewAccountHandler(&stubAccountProvider{})

	user := &models.AuthenticatedUser{UserID: uuid.MustParse("11111111-1111-1111-1111-111111111111")}
	handler := middleware.RequireAuth(stubAuthForHandlers{user: user})(http.HandlerFunc(h.RequestEmailVerification))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/verify/request", nil)
	req.Header.Set("Authorization", "Bearer token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "verification link has been sent") {
		t.Errorf("unexpected message: %s", rec.Body.String())
	}
}

func TestRequestEmailVerificationHandler_RateLimitPassesThrough(t *testing.T) {
	h := NewAccountHandler(&stubAccountProvider{
		requestVerificationErr: apperr.New(http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests"),
	})

	user := &models.AuthenticatedUser{UserID: uuid.New()}
	handler := middleware.RequireAuth(stubAuthForHandlers{user: user})(http.HandlerFunc(h.RequestEmailVerification))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/verify/request", nil)
	req.Header.Set("Authorization", "Bearer token")
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTooManyRequests)
	}
}

func TestVerifyEmailHandler_Validation(t *testing.T) {
	h := NewAccountHandler(&stubAccountProvider{})

	rec := httptest.NewRecorder()
	h.VerifyEmail(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/verify", strings.NewReader(`{}`)))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("expected VALIDATION_ERROR, got %s", rec.Body.String())
	}
}

func TestVerifyEmailHandler_SuccessAndErrors(t *testing.T) {
	ok := NewAccountHandler(&stubAccountProvider{})
	rec := httptest.NewRecorder()
	ok.VerifyEmail(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/verify",
		strings.NewReader(`{"token":"evt_some-token"}`)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "verified") {
		t.Errorf("success: status=%d body=%s", rec.Code, rec.Body.String())
	}

	invalid := NewAccountHandler(&stubAccountProvider{
		verifyErr: apperr.New(http.StatusBadRequest, "INVALID_VERIFICATION_TOKEN", "Invalid or expired verification link"),
	})
	rec = httptest.NewRecorder()
	invalid.VerifyEmail(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/email/verify",
		strings.NewReader(`{"token":"evt_bad-token"}`)))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "INVALID_VERIFICATION_TOKEN") {
		t.Errorf("error passthrough: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestForgotPasswordHandler_IdenticalResponses(t *testing.T) {
	// The stub records both calls and returns nil for each — exactly what
	// the real service does for existing AND unknown emails.
	h := NewAccountHandler(&stubAccountProvider{})

	makeReq := func(email string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ForgotPassword(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/password/forgot",
			strings.NewReader(`{"email":"`+email+`"}`)))
		return rec
	}

	existing := makeReq("jane@example.com")
	unknown := makeReq("ghost@example.com")

	if existing.Code != http.StatusOK || unknown.Code != http.StatusOK {
		t.Fatalf("status mismatch: existing=%d unknown=%d", existing.Code, unknown.Code)
	}
	if existing.Body.String() != unknown.Body.String() {
		t.Errorf("responses must be byte-identical:\nexisting: %s\nunknown:   %s", existing.Body.String(), unknown.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(existing.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := resp["message"]; !ok {
		t.Errorf("response missing message field: %s", existing.Body.String())
	}
}

func TestForgotPasswordHandler_InvalidEmail(t *testing.T) {
	h := NewAccountHandler(&stubAccountProvider{})

	for _, email := range []string{"", "not-an-email", "a@b"} {
		rec := httptest.NewRecorder()
		h.ForgotPassword(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/password/forgot",
			strings.NewReader(`{"email":"`+email+`"}`)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("email %q: status = %d, want %d", email, rec.Code, http.StatusBadRequest)
		}
	}
}

func TestResetPasswordHandler_Validation(t *testing.T) {
	h := NewAccountHandler(&stubAccountProvider{})

	cases := []struct {
		name string
		body string
		want string
	}{
		{"missing token", `{"new_password":"new-password-456"}`, "token"},
		{"short password", `{"token":"prt_x","new_password":"short"}`, "new_password"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ResetPassword(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/password/reset", strings.NewReader(c.body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want %d", c.name, rec.Code, http.StatusBadRequest)
		}
		if !strings.Contains(rec.Body.String(), c.want) {
			t.Errorf("%s: message should mention %q, got %s", c.name, c.want, rec.Body.String())
		}
	}
}

func TestResetPasswordHandler_SuccessAndErrors(t *testing.T) {
	ok := NewAccountHandler(&stubAccountProvider{})
	rec := httptest.NewRecorder()
	ok.ResetPassword(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/password/reset",
		strings.NewReader(`{"token":"prt_x","new_password":"new-password-456"}`)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "has been reset") {
		t.Errorf("success: status=%d body=%s", rec.Code, rec.Body.String())
	}

	invalid := NewAccountHandler(&stubAccountProvider{
		resetErr: apperr.New(http.StatusBadRequest, "INVALID_RESET_TOKEN", "Invalid or expired reset link"),
	})
	rec = httptest.NewRecorder()
	invalid.ResetPassword(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/password/reset",
		strings.NewReader(`{"token":"prt_bad","new_password":"new-password-456"}`)))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "INVALID_RESET_TOKEN") {
		t.Errorf("error passthrough: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

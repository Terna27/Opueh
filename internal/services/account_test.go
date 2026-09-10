package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/email"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/ratelimit"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// ---------------------------------------------------------------------------
// Fakes (reuse fakeUserStore / fakeSessionStore from auth_test.go)
// ---------------------------------------------------------------------------

// findIncludingDeleted mirrors the repo JOINs, which see soft-deleted users
// (the FK still resolves); only explicit filters hide them.
func (f *fakeUserStore) findIncludingDeleted(id uuid.UUID) *models.User {
	for _, u := range f.users {
		if u.ID == id {
			return u
		}
	}
	return nil
}

// revokeAllForUser simulates the reset flow's bulk session revocation.
func (f *fakeSessionStore) revokeAllForUser(userID uuid.UUID) {
	now := time.Now().UTC()
	for _, sess := range f.sessions {
		if sess.userID == userID && sess.revokedAt == nil {
			sess.revokedAt = &now
		}
	}
	for _, tok := range f.tokens {
		sess := f.sessions[tok.sessionID]
		if sess != nil && sess.userID == userID && tok.revokedAt == nil {
			tok.revokedAt = &now
		}
	}
}

type fakeVerificationToken struct {
	id         uuid.UUID
	userID     uuid.UUID
	createdAt  time.Time
	expiresAt  time.Time
	consumedAt *time.Time
}

type fakeVerificationStore struct {
	tokens map[string]*fakeVerificationToken // keyed by token hash
	users  *fakeUserStore
}

func newFakeVerificationStore(users *fakeUserStore) *fakeVerificationStore {
	return &fakeVerificationStore{tokens: make(map[string]*fakeVerificationToken), users: users}
}

func (f *fakeVerificationStore) CreateEmailVerification(ctx context.Context, userID uuid.UUID, tokenHash string, expiresAt, now time.Time) error {
	for _, tok := range f.tokens {
		if tok.userID == userID && tok.consumedAt == nil {
			consumed := now
			tok.consumedAt = &consumed
		}
	}
	f.tokens[tokenHash] = &fakeVerificationToken{
		id: uuid.New(), userID: userID, createdAt: now, expiresAt: expiresAt,
	}
	return nil
}

func (f *fakeVerificationStore) GetEmailVerificationState(ctx context.Context, tokenHash string) (*repositories.EmailVerificationState, error) {
	tok, ok := f.tokens[tokenHash]
	if !ok {
		return nil, fmt.Errorf("%w: verification token", repositories.ErrNotFound)
	}
	user := f.users.findIncludingDeleted(tok.userID)
	if user == nil {
		return nil, fmt.Errorf("%w: user", repositories.ErrNotFound)
	}
	return &repositories.EmailVerificationState{
		TokenID:         tok.id,
		UserID:          tok.userID,
		ExpiresAt:       tok.expiresAt,
		ConsumedAt:      tok.consumedAt,
		UserStatus:      user.Status,
		UserDeletedAt:   user.DeletedAt,
		EmailVerifiedAt: user.EmailVerifiedAt,
	}, nil
}

func (f *fakeVerificationStore) VerifyEmail(ctx context.Context, tokenID, userID uuid.UUID, now time.Time) error {
	var tok *fakeVerificationToken
	for _, t := range f.tokens {
		if t.id == tokenID {
			tok = t
			break
		}
	}
	if tok == nil {
		return fmt.Errorf("%w: token", repositories.ErrNotFound)
	}
	if tok.consumedAt != nil || !tok.expiresAt.After(now) {
		return repositories.ErrTokenAlreadyUsed
	}
	user := f.users.findIncludingDeleted(userID)
	if user == nil || user.DeletedAt != nil {
		return fmt.Errorf("%w: user", repositories.ErrNotFound)
	}
	consumed := now
	tok.consumedAt = &consumed
	if user.EmailVerifiedAt == nil {
		verified := now
		user.EmailVerifiedAt = &verified
	}
	return nil
}

func (f *fakeVerificationStore) LatestEmailVerificationCreatedAt(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var latest *time.Time
	for _, tok := range f.tokens {
		if tok.userID == userID && (latest == nil || tok.createdAt.After(*latest)) {
			created := tok.createdAt
			latest = &created
		}
	}
	return latest, nil
}

type fakeResetToken struct {
	id          uuid.UUID
	userID      uuid.UUID
	createdAt   time.Time
	expiresAt   time.Time
	consumedAt  *time.Time
	requestedIP string
}

type fakeResetStore struct {
	tokens   map[string]*fakeResetToken // keyed by token hash
	users    *fakeUserStore
	sessions *fakeSessionStore
}

func newFakeResetStore(users *fakeUserStore, sessions *fakeSessionStore) *fakeResetStore {
	return &fakeResetStore{tokens: make(map[string]*fakeResetToken), users: users, sessions: sessions}
}

func (f *fakeResetStore) CreatePasswordReset(ctx context.Context, userID uuid.UUID, tokenHash, ip string, expiresAt, now time.Time) error {
	for _, tok := range f.tokens {
		if tok.userID == userID && tok.consumedAt == nil {
			consumed := now
			tok.consumedAt = &consumed
		}
	}
	f.tokens[tokenHash] = &fakeResetToken{
		id: uuid.New(), userID: userID, createdAt: now, expiresAt: expiresAt, requestedIP: ip,
	}
	return nil
}

func (f *fakeResetStore) GetPasswordResetState(ctx context.Context, tokenHash string) (*repositories.PasswordResetState, error) {
	tok, ok := f.tokens[tokenHash]
	if !ok {
		return nil, fmt.Errorf("%w: reset token", repositories.ErrNotFound)
	}
	user := f.users.findIncludingDeleted(tok.userID)
	if user == nil {
		return nil, fmt.Errorf("%w: user", repositories.ErrNotFound)
	}
	return &repositories.PasswordResetState{
		TokenID:       tok.id,
		UserID:        tok.userID,
		ExpiresAt:     tok.expiresAt,
		ConsumedAt:    tok.consumedAt,
		UserStatus:    user.Status,
		UserDeletedAt: user.DeletedAt,
	}, nil
}

func (f *fakeResetStore) CompletePasswordReset(ctx context.Context, tokenID, userID uuid.UUID, passwordHash string, now time.Time) error {
	var tok *fakeResetToken
	for _, t := range f.tokens {
		if t.id == tokenID {
			tok = t
			break
		}
	}
	if tok == nil {
		return fmt.Errorf("%w: token", repositories.ErrNotFound)
	}
	if tok.consumedAt != nil || !tok.expiresAt.After(now) {
		return repositories.ErrTokenAlreadyUsed
	}
	user := f.users.findIncludingDeleted(userID)
	if user == nil || user.DeletedAt != nil {
		return fmt.Errorf("%w: user", repositories.ErrNotFound)
	}
	consumed := now
	tok.consumedAt = &consumed
	user.PasswordHash = passwordHash
	f.sessions.revokeAllForUser(userID)
	return nil
}

func (f *fakeResetStore) LatestPasswordResetCreatedAt(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var latest *time.Time
	for _, tok := range f.tokens {
		if tok.userID == userID && (latest == nil || tok.createdAt.After(*latest)) {
			created := tok.createdAt
			latest = &created
		}
	}
	return latest, nil
}

// captureSender records outgoing emails instead of delivering them.
type captureSender struct {
	messages []email.Message
	err      error
}

func (c *captureSender) Send(ctx context.Context, msg email.Message) error {
	if c.err != nil {
		return c.err
	}
	c.messages = append(c.messages, msg)
	return nil
}

// extractToken pulls the token query parameter out of an emailed link.
func extractToken(t *testing.T, body string) string {
	t.Helper()
	idx := strings.Index(body, "token=")
	if idx < 0 {
		t.Fatalf("no token in email body: %q", body)
	}
	rest := body[idx+len("token="):]
	if end := strings.IndexAny(rest, "\n& "); end >= 0 {
		rest = rest[:end]
	}
	return rest
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type accountHarness struct {
	users         *fakeUserStore
	sessions      *fakeSessionStore
	verifications *fakeVerificationStore
	resets        *fakeResetStore
	mailer        *captureSender
	svc           *AccountService
	authSvc       *AuthService
}

func newAccountHarness(t *testing.T) *accountHarness {
	t.Helper()
	users := &fakeUserStore{}
	sessions := newFakeSessionStore(users)
	verifications := newFakeVerificationStore(users)
	resets := newFakeResetStore(users, sessions)
	mailer := &captureSender{}

	svc := NewAccountService(users, verifications, resets, mailer, ratelimit.NoopLimiter{}, AccountConfig{
		AppURL:                    "http://localhost:3000",
		EmailVerificationTokenTTL: 24 * time.Hour,
		PasswordResetTokenTTL:     time.Hour,
		EmailResendCooldown:       time.Minute,
		PasswordResetCooldown:     time.Minute,
	})
	authSvc := NewAuthService(
		users, sessions,
		auth.NewJWTManager(testJWTSecret, testJWTIssuer, 15*time.Minute),
		AuthConfig{AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, SessionTTL: 24 * time.Hour},
		NoopLoginProtection(), // login throttling is not under test here
	)
	return &accountHarness{
		users: users, sessions: sessions, verifications: verifications,
		resets: resets, mailer: mailer, svc: svc, authSvc: authSvc,
	}
}

// register creates a user through the real register flow.
func (h *accountHarness) register(t *testing.T, email, username string) *AuthResult {
	t.Helper()
	res, err := h.authSvc.Register(context.Background(), RegisterInput{
		Email: email, Username: username, Password: "password123",
	}, ClientMeta{UserAgent: "test", IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	return res
}

// ---------------------------------------------------------------------------
// Email verification: request / resend
// ---------------------------------------------------------------------------

func TestRequestEmailVerification_SendsLinkAndStoresHash(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("RequestEmailVerification: %v", err)
	}

	if len(h.mailer.messages) != 1 {
		t.Fatalf("emails sent = %d, want 1", len(h.mailer.messages))
	}
	msg := h.mailer.messages[0]
	if msg.To != "jane@example.com" {
		t.Errorf("email sent to %q", msg.To)
	}
	if !strings.Contains(msg.Body, "http://localhost:3000/verify-email?token=evt_") {
		t.Errorf("link missing/wrong in body: %q", msg.Body)
	}

	token := extractToken(t, msg.Body)
	// Only the hash may be stored — never the plaintext token.
	if _, stored := h.verifications.tokens[token]; stored {
		t.Error("plaintext verification token was stored")
	}
	if _, stored := h.verifications.tokens[auth.HashToken(token)]; !stored {
		t.Error("token hash was not stored")
	}
}

func TestRequestEmailVerification_AlreadyVerified_NoEmail(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	now := time.Now().UTC()
	h.users.users[0].EmailVerifiedAt = &now

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("already-verified request should succeed idempotently: %v", err)
	}
	if len(h.mailer.messages) != 0 {
		t.Errorf("email sent for an already-verified user: %+v", h.mailer.messages)
	}
}

func TestRequestEmailVerification_Cooldown(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("first request: %v", err)
	}
	err := h.svc.RequestEmailVerification(ctx, res.User.ID)
	assertAppErr(t, err, 429, "RATE_LIMITED")
	if len(h.mailer.messages) != 1 {
		t.Errorf("second request within cooldown must not send: %d sent", len(h.mailer.messages))
	}
}

func TestRequestEmailVerification_ResendSupersedesOldToken(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("first request: %v", err)
	}
	firstToken := extractToken(t, h.mailer.messages[0].Body)

	// Elude the cooldown so the resend actually happens.
	for _, tok := range h.verifications.tokens {
		tok.createdAt = time.Now().Add(-2 * time.Minute)
	}

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("resend: %v", err)
	}
	secondToken := extractToken(t, h.mailer.messages[1].Body)

	// The old token must no longer be redeemable.
	err := h.svc.VerifyEmail(ctx, firstToken)
	assertAppErr(t, err, 400, "INVALID_VERIFICATION_TOKEN")

	// The new one must work.
	if err := h.svc.VerifyEmail(ctx, secondToken); err != nil {
		t.Fatalf("new token should verify: %v", err)
	}
	if h.users.users[0].EmailVerifiedAt == nil {
		t.Error("email_verified_at was not set after verification")
	}
}

func TestRequestEmailVerification_UnknownUser(t *testing.T) {
	h := newAccountHarness(t)

	err := h.svc.RequestEmailVerification(context.Background(), uuid.New())
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

// ---------------------------------------------------------------------------
// Email verification: redemption
// ---------------------------------------------------------------------------

func TestVerifyEmail_Success(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("request: %v", err)
	}
	token := extractToken(t, h.mailer.messages[0].Body)

	if err := h.svc.VerifyEmail(ctx, token); err != nil {
		t.Fatalf("VerifyEmail: %v", err)
	}
	if h.users.users[0].EmailVerifiedAt == nil {
		t.Error("email_verified_at not set")
	}

	// Idempotent: verifying again with the same (now consumed) token
	// succeeds because the email is already verified.
	if err := h.svc.VerifyEmail(ctx, token); err != nil {
		t.Errorf("repeat verification should be idempotent: %v", err)
	}
}

func TestVerifyEmail_GarbageToken(t *testing.T) {
	h := newAccountHarness(t)

	err := h.svc.VerifyEmail(context.Background(), "evt_not-a-real-token")
	assertAppErr(t, err, 400, "INVALID_VERIFICATION_TOKEN")
}

func TestVerifyEmail_ExpiredToken(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("request: %v", err)
	}
	token := extractToken(t, h.mailer.messages[0].Body)

	// Expire the stored token behind the service's back.
	for _, tok := range h.verifications.tokens {
		tok.expiresAt = time.Now().Add(-time.Minute)
	}

	err := h.svc.VerifyEmail(ctx, token)
	assertAppErr(t, err, 400, "INVALID_VERIFICATION_TOKEN")
	if h.users.users[0].EmailVerifiedAt != nil {
		t.Error("expired token must not verify the email")
	}
}

func TestVerifyEmail_UsedTokenWhileUnverified(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	// Two requests: the first token gets superseded (consumed) while the
	// user is still unverified.
	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("request: %v", err)
	}
	firstToken := extractToken(t, h.mailer.messages[0].Body)
	for _, tok := range h.verifications.tokens {
		tok.createdAt = time.Now().Add(-2 * time.Minute)
	}
	if err := h.svc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("resend: %v", err)
	}

	err := h.svc.VerifyEmail(ctx, firstToken)
	assertAppErr(t, err, 400, "INVALID_VERIFICATION_TOKEN")
	if h.users.users[0].EmailVerifiedAt != nil {
		t.Error("superseded token must not verify the email")
	}
}

func TestVerifyEmail_SendFailureIsServerError(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	h.mailer.err = errors.New("smtp exploded")
	err := h.svc.RequestEmailVerification(ctx, res.User.ID)
	assertAppErr(t, err, 500, "EMAIL_SEND_FAILED")
}

// ---------------------------------------------------------------------------
// Password reset: request
// ---------------------------------------------------------------------------

func TestRequestPasswordReset_ExistingEmail(t *testing.T) {
	h := newAccountHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "203.0.113.5"}); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}

	if len(h.mailer.messages) != 1 {
		t.Fatalf("emails sent = %d, want 1", len(h.mailer.messages))
	}
	body := h.mailer.messages[0].Body
	if !strings.Contains(body, "http://localhost:3000/reset-password?token=prt_") {
		t.Errorf("reset link missing/wrong: %q", body)
	}

	token := extractToken(t, body)
	if _, stored := h.resets.tokens[token]; stored {
		t.Error("plaintext reset token was stored")
	}
	storedTok, ok := h.resets.tokens[auth.HashToken(token)]
	if !ok {
		t.Fatal("reset token hash was not stored")
	}
	if storedTok.requestedIP != "203.0.113.5" {
		t.Errorf("requested IP = %q, want 203.0.113.5", storedTok.requestedIP)
	}
}

func TestRequestPasswordReset_UnknownEmailIsIndistinguishable(t *testing.T) {
	h := newAccountHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	existingErr := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"})
	unknownErr := h.svc.RequestPasswordReset(ctx, "ghost@example.com", ClientMeta{IP: "127.0.0.1"})

	// Both must be nil: the handler cannot distinguish existing from
	// unknown emails, so it emits the same response for both.
	if existingErr != nil || unknownErr != nil {
		t.Fatalf("reset request errors must be nil: existing=%v unknown=%v", existingErr, unknownErr)
	}

	// But only the existing account received mail.
	if len(h.mailer.messages) != 1 {
		t.Errorf("emails sent = %d, want 1 (only the existing account)", len(h.mailer.messages))
	}
}

func TestRequestPasswordReset_CooldownIsSilent(t *testing.T) {
	h := newAccountHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"}); err != nil {
		t.Fatalf("first request: %v", err)
	}
	// Second request within the cooldown: same nil (success) response,
	// but no second email.
	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"}); err != nil {
		t.Fatalf("cooldown must be silent: %v", err)
	}
	if len(h.mailer.messages) != 1 {
		t.Errorf("emails sent = %d, want 1 (cooldown suppressed the resend)", len(h.mailer.messages))
	}
}

func TestRequestPasswordReset_IPRateLimited(t *testing.T) {
	users := &fakeUserStore{}
	sessions := newFakeSessionStore(users)
	svc := NewAccountService(
		users,
		newFakeVerificationStore(users),
		newFakeResetStore(users, sessions),
		&captureSender{},
		ratelimit.NewMemoryLimiter(1, time.Hour), // one request per IP per hour
		AccountConfig{
			AppURL: "http://localhost:3000", EmailVerificationTokenTTL: time.Hour,
			PasswordResetTokenTTL: time.Hour, EmailResendCooldown: 0, PasswordResetCooldown: 0,
		},
	)
	ctx := context.Background()

	if err := svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "198.51.100.7"}); err != nil {
		t.Fatalf("first request: %v", err)
	}
	err := svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "198.51.100.7"})
	assertAppErr(t, err, 429, "RATE_LIMITED")
}

// ---------------------------------------------------------------------------
// Password reset: redemption
// ---------------------------------------------------------------------------

func TestResetPassword_FullFlow(t *testing.T) {
	h := newAccountHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	// A second session exists (login from another device).
	second, err := h.authSvc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}

	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"}); err != nil {
		t.Fatalf("request reset: %v", err)
	}
	token := extractToken(t, h.mailer.messages[0].Body)

	if err := h.svc.ResetPassword(ctx, token, "new-password-456", ClientMeta{}); err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}

	// Old password no longer works.
	_, err = h.authSvc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")

	// New password works.
	fresh, err := h.authSvc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "new-password-456"}, ClientMeta{})
	if err != nil {
		t.Fatalf("login with new password: %v", err)
	}
	if fresh.User.ID != res.User.ID {
		t.Errorf("reset logged in a different user: %s", fresh.User.ID)
	}

	// ALL previous sessions are dead — registration session and the
	// second-device session alike.
	_, err = h.authSvc.Authenticate(ctx, res.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")
	_, err = h.authSvc.Authenticate(ctx, second.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")

	// The token is single-use.
	err = h.svc.ResetPassword(ctx, token, "another-password-789", ClientMeta{})
	assertAppErr(t, err, 400, "INVALID_RESET_TOKEN")
}

func TestResetPassword_GarbageToken(t *testing.T) {
	h := newAccountHarness(t)

	err := h.svc.ResetPassword(context.Background(), "prt_not-a-real-token", "new-password-456", ClientMeta{})
	assertAppErr(t, err, 400, "INVALID_RESET_TOKEN")
}

func TestResetPassword_ExpiredToken(t *testing.T) {
	h := newAccountHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"}); err != nil {
		t.Fatalf("request reset: %v", err)
	}
	token := extractToken(t, h.mailer.messages[0].Body)

	for _, tok := range h.resets.tokens {
		tok.expiresAt = time.Now().Add(-time.Minute)
	}

	err := h.svc.ResetPassword(ctx, token, "new-password-456", ClientMeta{})
	assertAppErr(t, err, 400, "INVALID_RESET_TOKEN")

	// The old password still works — nothing changed.
	if _, err := h.authSvc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{}); err != nil {
		t.Errorf("password must be unchanged after a failed reset: %v", err)
	}
}

func TestResetPassword_DeletedAccount(t *testing.T) {
	h := newAccountHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"}); err != nil {
		t.Fatalf("request reset: %v", err)
	}
	token := extractToken(t, h.mailer.messages[0].Body)

	now := time.Now().UTC()
	h.users.users[0].DeletedAt = &now

	err := h.svc.ResetPassword(ctx, token, "new-password-456", ClientMeta{})
	assertAppErr(t, err, 400, "INVALID_RESET_TOKEN")
}

func TestResetPassword_WeakPasswordRejectedByService(t *testing.T) {
	h := newAccountHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	if err := h.svc.RequestPasswordReset(ctx, "jane@example.com", ClientMeta{IP: "127.0.0.1"}); err != nil {
		t.Fatalf("request reset: %v", err)
	}
	token := extractToken(t, h.mailer.messages[0].Body)

	// Handlers validate this, but the service must not trust that every
	// caller did.
	err := h.svc.ResetPassword(ctx, token, "short", ClientMeta{})
	assertAppErr(t, err, 400, "VALIDATION_ERROR")
}

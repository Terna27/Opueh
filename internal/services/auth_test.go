package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// fakeUserStore mimics UserRepository semantics: citext-style
// case-insensitive email/username uniqueness and lookups.
type fakeUserStore struct {
	users []*models.User
}

func (f *fakeUserStore) CreateWithProfile(ctx context.Context, email, username, passwordHash, displayName string) (*models.User, error) {
	for _, u := range f.users {
		if strings.EqualFold(u.Email, email) {
			return nil, &repositories.UniqueViolationError{Constraint: "users_email_unique"}
		}
		if strings.EqualFold(u.Username, username) {
			return nil, &repositories.UniqueViolationError{Constraint: "users_username_unique"}
		}
	}

	now := time.Now().UTC()
	u := &models.User{
		ID:           uuid.New(),
		Email:        email,
		Username:     username,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         "USER",
		Status:       "ACTIVE",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	f.users = append(f.users, u)
	return u, nil
}

func (f *fakeUserStore) GetByIdentifier(ctx context.Context, identifier string) (*models.User, error) {
	for _, u := range f.users {
		if strings.EqualFold(u.Email, identifier) || strings.EqualFold(u.Username, identifier) {
			return u, nil
		}
	}
	return nil, fmt.Errorf("%w: user %q", repositories.ErrNotFound, identifier)
}

func (f *fakeUserStore) GetByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	for _, u := range f.users {
		if u.ID == id && u.DeletedAt == nil {
			return u, nil
		}
	}
	return nil, fmt.Errorf("%w: user %s", repositories.ErrNotFound, id)
}

type fakeSession struct {
	userID    uuid.UUID
	revokedAt *time.Time
	expiresAt time.Time
}

type fakeToken struct {
	id        uuid.UUID
	sessionID uuid.UUID
	usedAt    *time.Time
	revokedAt *time.Time
	expiresAt time.Time
}

// fakeSessionStore mimics SessionRepository, including the atomic
// used-at-is-null rotation guard.
type fakeSessionStore struct {
	sessions   map[uuid.UUID]*fakeSession
	tokens     map[string]*fakeToken // keyed by token hash
	byTokenID  map[uuid.UUID]string  // token id -> hash
	userLookup func(ctx context.Context, id uuid.UUID) (*models.User, error)
}

func newFakeSessionStore(users *fakeUserStore) *fakeSessionStore {
	return &fakeSessionStore{
		sessions:  make(map[uuid.UUID]*fakeSession),
		tokens:    make(map[string]*fakeToken),
		byTokenID: make(map[uuid.UUID]string),
		userLookup: func(ctx context.Context, id uuid.UUID) (*models.User, error) {
			return users.GetByID(ctx, id)
		},
	}
}

func (f *fakeSessionStore) CreateSession(ctx context.Context, userID uuid.UUID, userAgent, ip string, expiresAt time.Time) (*models.Session, error) {
	s := &fakeSession{userID: userID, expiresAt: expiresAt}
	id := uuid.New()
	f.sessions[id] = s
	return &models.Session{ID: id, UserID: userID, ExpiresAt: expiresAt}, nil
}

func (f *fakeSessionStore) CreateRefreshToken(ctx context.Context, sessionID uuid.UUID, tokenHash string, expiresAt time.Time) error {
	f.tokens[tokenHash] = &fakeToken{
		id:        uuid.New(),
		sessionID: sessionID,
		expiresAt: expiresAt,
	}
	f.byTokenID[f.tokens[tokenHash].id] = tokenHash
	return nil
}

func (f *fakeSessionStore) GetRefreshTokenState(ctx context.Context, tokenHash string) (*repositories.RefreshTokenState, error) {
	tok, ok := f.tokens[tokenHash]
	if !ok {
		return nil, fmt.Errorf("%w: refresh token", repositories.ErrNotFound)
	}
	sess := f.sessions[tok.sessionID]
	user, err := f.userLookup(ctx, sess.userID)
	if err != nil {
		return nil, err
	}

	deletedAt := user.DeletedAt
	return &repositories.RefreshTokenState{
		TokenID:          tok.id,
		SessionID:        tok.sessionID,
		UserID:           sess.userID,
		UsedAt:           tok.usedAt,
		RevokedAt:        tok.revokedAt,
		ExpiresAt:        tok.expiresAt,
		SessionRevokedAt: sess.revokedAt,
		SessionExpiresAt: sess.expiresAt,
		UserStatus:       user.Status,
		UserDeletedAt:    deletedAt,
	}, nil
}

func (f *fakeSessionStore) RotateRefreshToken(ctx context.Context, oldTokenID uuid.UUID, newTokenHash string, newExpiresAt, now time.Time) error {
	oldHash, ok := f.byTokenID[oldTokenID]
	if !ok {
		return fmt.Errorf("%w: token %s", repositories.ErrNotFound, oldTokenID)
	}
	tok := f.tokens[oldHash]
	if tok.usedAt != nil || tok.revokedAt != nil {
		return repositories.ErrTokenAlreadyUsed
	}

	tok.usedAt = &now
	f.tokens[newTokenHash] = &fakeToken{
		id:        uuid.New(),
		sessionID: tok.sessionID,
		expiresAt: newExpiresAt,
	}
	f.byTokenID[f.tokens[newTokenHash].id] = newTokenHash
	return nil
}

func (f *fakeSessionStore) RevokeSession(ctx context.Context, sessionID uuid.UUID) error {
	if sess, ok := f.sessions[sessionID]; ok && sess.revokedAt == nil {
		now := time.Now().UTC()
		sess.revokedAt = &now
	}
	for _, tok := range f.tokens {
		if tok.sessionID == sessionID && tok.revokedAt == nil {
			now := time.Now().UTC()
			tok.revokedAt = &now
		}
	}
	return nil
}

func (f *fakeSessionStore) GetSessionAuthState(ctx context.Context, sessionID uuid.UUID) (*repositories.SessionAuthState, error) {
	sess, ok := f.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("%w: session %s", repositories.ErrNotFound, sessionID)
	}
	user, err := f.userLookup(ctx, sess.userID)
	if err != nil {
		return nil, err
	}
	return &repositories.SessionAuthState{
		UserID:           user.ID,
		Role:             user.Role,
		Status:           user.Status,
		UserDeletedAt:    user.DeletedAt,
		SessionRevokedAt: sess.revokedAt,
		SessionExpiresAt: sess.expiresAt,
	}, nil
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const (
	testJWTSecret = "test-secret-that-is-at-least-32-bytes-long!"
	testJWTIssuer = "opueh-test"
)

type testHarness struct {
	users    *fakeUserStore
	sessions *fakeSessionStore
	svc      *AuthService
}

func newTestHarness(t *testing.T) *testHarness {
	t.Helper()
	users := &fakeUserStore{}
	sessions := newFakeSessionStore(users)
	svc := NewAuthService(
		users,
		sessions,
		auth.NewJWTManager(testJWTSecret, testJWTIssuer, 15*time.Minute),
		AuthConfig{AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, SessionTTL: 24 * time.Hour},
	)
	return &testHarness{users: users, sessions: sessions, svc: svc}
}

func (h *testHarness) register(t *testing.T, email, username string) *AuthResult {
	t.Helper()
	res, err := h.svc.Register(context.Background(), RegisterInput{
		Email:    email,
		Username: username,
		Password: "password123",
	}, ClientMeta{UserAgent: "test", IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register %s: %v", email, err)
	}
	return res
}

// assertAppErr fails unless err is an *apperr.Error with the given status
// and code.
func assertAppErr(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %s, got nil", code)
	}
	var ae *apperr.Error
	if !errors.As(err, &ae) {
		t.Fatalf("expected *apperr.Error, got %T: %v", err, err)
	}
	if ae.Status != status {
		t.Errorf("status = %d, want %d", ae.Status, status)
	}
	if ae.Code != code {
		t.Errorf("code = %q, want %q", ae.Code, code)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegister_Success(t *testing.T) {
	h := newTestHarness(t)

	res, err := h.svc.Register(context.Background(), RegisterInput{
		Email:    "Jane@Example.com",
		Username: "jane_doe",
		Password: "password123",
	}, ClientMeta{UserAgent: "test-agent", IP: "192.0.2.10"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	// Email must be normalized to lowercase before storage.
	if res.User.Email != "jane@example.com" {
		t.Errorf("email = %q, want normalized lowercase", res.User.Email)
	}
	// Display name defaults to the username when not supplied.
	if res.User.DisplayName != "jane_doe" {
		t.Errorf("display_name = %q, want default to username", res.User.DisplayName)
	}
	// Password must be stored hashed, never in plaintext.
	if !strings.HasPrefix(h.users.users[0].PasswordHash, "$argon2id$") {
		t.Errorf("stored password hash is not argon2id: %q", h.users.users[0].PasswordHash)
	}
	if strings.Contains(h.users.users[0].PasswordHash, "password123") {
		t.Error("password hash contains the plaintext password")
	}

	if res.AccessToken == "" || res.RefreshToken == "" {
		t.Error("registration must return both tokens (auto-login)")
	}
	if res.TokenType != "Bearer" || res.ExpiresIn != 900 {
		t.Errorf("token metadata wrong: %+v", res)
	}
	// The issued access token must authenticate immediately.
	if _, err := h.svc.Authenticate(context.Background(), res.AccessToken); err != nil {
		t.Errorf("fresh access token does not authenticate: %v", err)
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	h := newTestHarness(t)
	h.register(t, "jane@example.com", "jane_doe")

	_, err := h.svc.Register(context.Background(), RegisterInput{
		Email:    "JANE@example.com", // case variation — citext would also collide
		Username: "different_user",
		Password: "password123",
	}, ClientMeta{})
	assertAppErr(t, err, 409, "EMAIL_ALREADY_EXISTS")
}

func TestRegister_DuplicateUsername(t *testing.T) {
	h := newTestHarness(t)
	h.register(t, "jane@example.com", "jane_doe")

	_, err := h.svc.Register(context.Background(), RegisterInput{
		Email:    "other@example.com",
		Username: "Jane_Doe",
		Password: "password123",
	}, ClientMeta{})
	assertAppErr(t, err, 409, "USERNAME_ALREADY_EXISTS")
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

func TestLogin_SuccessByEmailAndUsername(t *testing.T) {
	h := newTestHarness(t)
	h.register(t, "jane@example.com", "jane_doe")

	byEmail, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "JANE@EXAMPLE.COM", // service lowercases; DB matches citext
		Password:   "password123",
	}, ClientMeta{})
	if err != nil {
		t.Fatalf("login by email: %v", err)
	}
	if byEmail.User.Username != "jane_doe" {
		t.Errorf("logged in wrong user: %+v", byEmail.User)
	}

	byUsername, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane_doe",
		Password:   "password123",
	}, ClientMeta{})
	if err != nil {
		t.Fatalf("login by username: %v", err)
	}
	if byUsername.User.ID != byEmail.User.ID {
		t.Error("email and username login resolved to different users")
	}
}

func TestLogin_UnknownIdentifier(t *testing.T) {
	h := newTestHarness(t)

	_, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "ghost@example.com",
		Password:   "password123",
	}, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
}

func TestLogin_WrongPassword_MatchesUnknownIdentifierError(t *testing.T) {
	h := newTestHarness(t)
	h.register(t, "jane@example.com", "jane_doe")

	_, wrongPassword := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "not-the-password",
	}, ClientMeta{})
	_, unknownUser := h.svc.Login(context.Background(), LoginInput{
		Identifier: "ghost@example.com",
		Password:   "not-the-password",
	}, ClientMeta{})

	// Anti-enumeration: both failures must be indistinguishable.
	assertAppErr(t, wrongPassword, 401, "INVALID_CREDENTIALS")
	assertAppErr(t, unknownUser, 401, "INVALID_CREDENTIALS")

	var wp, uu *apperr.Error
	errors.As(wrongPassword, &wp)
	errors.As(unknownUser, &uu)
	if wp.Message != uu.Message || wp.Status != uu.Status {
		t.Error("wrong-password and unknown-user errors must be identical")
	}
}

func TestLogin_SuspendedAccount(t *testing.T) {
	h := newTestHarness(t)
	res := h.register(t, "jane@example.com", "jane_doe")
	h.users.users[0].Status = "SUSPENDED"

	_, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{})
	assertAppErr(t, err, 403, "ACCOUNT_SUSPENDED")

	// An existing access token must also be refused while suspended.
	_, err = h.svc.Authenticate(context.Background(), res.AccessToken)
	assertAppErr(t, err, 403, "ACCOUNT_SUSPENDED")
}

func TestLogin_BannedAccount(t *testing.T) {
	h := newTestHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	h.users.users[0].Status = "BANNED"

	_, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{})
	assertAppErr(t, err, 403, "ACCOUNT_BANNED")
}

func TestLogin_DeletedAccount(t *testing.T) {
	h := newTestHarness(t)
	h.register(t, "jane@example.com", "jane_doe")
	now := time.Now().UTC()
	h.users.users[0].DeletedAt = &now

	// A soft-deleted user must not be able to log in — and must get the
	// generic credentials error, not "user deleted" information.
	_, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
}

// ---------------------------------------------------------------------------
// Refresh rotation and replay detection
// ---------------------------------------------------------------------------

func TestRefresh_Rotation(t *testing.T) {
	h := newTestHarness(t)
	initial := h.register(t, "jane@example.com", "jane_doe")

	res, err := h.svc.Refresh(context.Background(), initial.RefreshToken, ClientMeta{})
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}

	if res.RefreshToken == initial.RefreshToken {
		t.Error("refresh token was not rotated")
	}
	if res.AccessToken == "" {
		t.Error("refresh did not issue a new access token")
	}
	// The new access token must work immediately.
	ident, err := h.svc.Authenticate(context.Background(), res.AccessToken)
	if err != nil {
		t.Fatalf("new access token rejected: %v", err)
	}
	if ident.UserID != initial.User.ID {
		t.Errorf("refresh authenticated as %s, want %s", ident.UserID, initial.User.ID)
	}
	// The new refresh token must also be usable (chain continues).
	if _, err := h.svc.Refresh(context.Background(), res.RefreshToken, ClientMeta{}); err != nil {
		t.Fatalf("chained refresh failed: %v", err)
	}
}

func TestRefresh_ReusedTokenRevokesEntireSession(t *testing.T) {
	h := newTestHarness(t)
	initial := h.register(t, "jane@example.com", "jane_doe")

	rotated, err := h.svc.Refresh(context.Background(), initial.RefreshToken, ClientMeta{})
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}

	// Replay the OLD token: theft signal. Must fail...
	_, err = h.svc.Refresh(context.Background(), initial.RefreshToken, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")

	// ...and must have revoked the whole session: the NEW access token
	// (issued moments ago) is now dead too.
	_, err = h.svc.Authenticate(context.Background(), rotated.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")

	// ...and the NEW refresh token is dead as well.
	_, err = h.svc.Refresh(context.Background(), rotated.RefreshToken, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")
}

func TestRefresh_GarbageToken(t *testing.T) {
	h := newTestHarness(t)

	_, err := h.svc.Refresh(context.Background(), "rt_totally-made-up", ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")

	_, err = h.svc.Refresh(context.Background(), "", ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")
}

func TestRefresh_ExpiredTokenDoesNotRevokeSession(t *testing.T) {
	h := newTestHarness(t)
	initial := h.register(t, "jane@example.com", "jane_doe")

	// Expire the stored token behind the service's back.
	hash := auth.HashRefreshToken(initial.RefreshToken)
	h.sessions.tokens[hash].expiresAt = time.Now().Add(-time.Minute)

	_, err := h.svc.Refresh(context.Background(), initial.RefreshToken, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")

	// Expiry is not theft: the session itself must stay alive, so the
	// still-valid access token keeps working.
	if _, err := h.svc.Authenticate(context.Background(), initial.AccessToken); err != nil {
		t.Errorf("session was revoked because a token expired: %v", err)
	}
}

func TestRefresh_RevokedSessionToken(t *testing.T) {
	h := newTestHarness(t)
	initial := h.register(t, "jane@example.com", "jane_doe")

	if err := h.svc.Logout(context.Background(), sessionIDOf(t, h, initial)); err != nil {
		t.Fatalf("logout: %v", err)
	}

	_, err := h.svc.Refresh(context.Background(), initial.RefreshToken, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")
}

// sessionIDOf extracts the session ID for a result by asking the auth
// middleware path (the token carries it).
func sessionIDOf(t *testing.T, h *testHarness, res *AuthResult) uuid.UUID {
	t.Helper()
	ident, err := h.svc.Authenticate(context.Background(), res.AccessToken)
	if err != nil {
		t.Fatalf("authenticate to read session id: %v", err)
	}
	return ident.SessionID
}

// ---------------------------------------------------------------------------
// Logout and Authenticate
// ---------------------------------------------------------------------------

func TestLogout_RevokesSession(t *testing.T) {
	h := newTestHarness(t)
	initial := h.register(t, "jane@example.com", "jane_doe")
	sessionID := sessionIDOf(t, h, initial)

	if err := h.svc.Logout(context.Background(), sessionID); err != nil {
		t.Fatalf("logout: %v", err)
	}

	_, err := h.svc.Authenticate(context.Background(), initial.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")

	// Logout is idempotent.
	if err := h.svc.Logout(context.Background(), sessionID); err != nil {
		t.Errorf("second logout should be a no-op, got: %v", err)
	}
}

func TestAuthenticate_HappyPath(t *testing.T) {
	h := newTestHarness(t)
	initial := h.register(t, "jane@example.com", "jane_doe")

	ident, err := h.svc.Authenticate(context.Background(), initial.AccessToken)
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if ident.UserID != initial.User.ID {
		t.Errorf("userID = %s, want %s", ident.UserID, initial.User.ID)
	}
	if ident.Role != "USER" {
		t.Errorf("role = %q, want USER (fresh from store, not from the JWT)", ident.Role)
	}
	if ident.SessionID == uuid.Nil {
		t.Error("session ID missing from authenticated identity")
	}
}

func TestAuthenticate_ExpiredJWT(t *testing.T) {
	users := &fakeUserStore{}
	sessions := newFakeSessionStore(users)
	svc := NewAuthService(
		users, sessions,
		auth.NewJWTManager(testJWTSecret, testJWTIssuer, -time.Minute), // everything already expired
		AuthConfig{AccessTokenTTL: time.Minute, RefreshTokenTTL: time.Hour, SessionTTL: 24 * time.Hour},
	)

	res, err := svc.Register(context.Background(), RegisterInput{
		Email: "jane@example.com", Username: "jane_doe", Password: "password123",
	}, ClientMeta{})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	_, err = svc.Authenticate(context.Background(), res.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")
}

func TestAuthenticate_GarbageToken(t *testing.T) {
	h := newTestHarness(t)

	for _, token := range []string{"", "garbage", "not.a.jwt"} {
		_, err := h.svc.Authenticate(context.Background(), token)
		assertAppErr(t, err, 401, "INVALID_TOKEN")
	}
}

func TestGetUser_NotFound(t *testing.T) {
	h := newTestHarness(t)

	_, err := h.svc.GetUser(context.Background(), uuid.New())
	assertAppErr(t, err, 404, "USER_NOT_FOUND")
}

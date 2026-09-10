package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/ratelimit"
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
	userID     uuid.UUID
	createdAt  time.Time
	userAgent  string
	ip         string
	lastUsedAt *time.Time
	revokedAt  *time.Time
	expiresAt  time.Time
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
	now := time.Now().UTC()
	s := &fakeSession{
		userID:    userID,
		createdAt: now,
		userAgent: userAgent,
		ip:        ip,
		expiresAt: expiresAt,
	}
	id := uuid.New()
	f.sessions[id] = s
	return &models.Session{ID: id, UserID: userID, CreatedAt: now, ExpiresAt: expiresAt}, nil
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

// ListUserSessions mimics the repository semantics: only active (unrevoked,
// unexpired) sessions, newest first.
func (f *fakeSessionStore) ListUserSessions(ctx context.Context, userID uuid.UUID) ([]models.SessionInfo, error) {
	now := time.Now().UTC()
	var out []models.SessionInfo
	for id, sess := range f.sessions {
		if sess.userID != userID || sess.revokedAt != nil || !sess.expiresAt.After(now) {
			continue
		}
		var ua, ip *string
		if sess.userAgent != "" {
			ua = &sess.userAgent
		}
		if sess.ip != "" {
			ip = &sess.ip
		}
		out = append(out, models.SessionInfo{
			ID:         id,
			CreatedAt:  sess.createdAt,
			LastUsedAt: sess.lastUsedAt,
			ExpiresAt:  sess.expiresAt,
			UserAgent:  ua,
			IPAddress:  ip,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

// RevokeUserSession mimics the ownership-scoped repository revocation:
// unknown or foreign session IDs are indistinguishable (ErrNotFound);
// already-revoked is a no-op.
func (f *fakeSessionStore) RevokeUserSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	sess, ok := f.sessions[sessionID]
	if !ok || sess.userID != userID {
		return fmt.Errorf("%w: session %s for user %s", repositories.ErrNotFound, sessionID, userID)
	}
	if sess.revokedAt != nil {
		return nil
	}
	now := time.Now().UTC()
	sess.revokedAt = &now
	for _, tok := range f.tokens {
		if tok.sessionID == sessionID && tok.revokedAt == nil {
			tok.revokedAt = &now
		}
	}
	return nil
}

// RevokeOtherSessions mimics revoking every active session except the kept
// one, including their refresh tokens.
func (f *fakeSessionStore) RevokeOtherSessions(ctx context.Context, userID, keepSessionID uuid.UUID) error {
	now := time.Now().UTC()
	for id, sess := range f.sessions {
		if sess.userID != userID || id == keepSessionID || sess.revokedAt != nil {
			continue
		}
		sess.revokedAt = &now
		for _, tok := range f.tokens {
			if tok.sessionID == id && tok.revokedAt == nil {
				tok.revokedAt = &now
			}
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
	return newHarnessWithProtection(t, NoopLoginProtection())
}

// newHarnessWithProtection builds a harness whose login protections are
// supplied by the test — real limiters/tracker for brute-force tests.
func newHarnessWithProtection(t *testing.T, protection LoginProtection) *testHarness {
	t.Helper()
	users := &fakeUserStore{}
	sessions := newFakeSessionStore(users)
	svc := NewAuthService(
		users,
		sessions,
		auth.NewJWTManager(testJWTSecret, testJWTIssuer, 15*time.Minute),
		AuthConfig{AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, SessionTTL: 24 * time.Hour},
		protection,
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
	hash := auth.HashToken(initial.RefreshToken)
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
		NoopLoginProtection(),
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

// ---------------------------------------------------------------------------
// Login brute-force protection (M5)
// ---------------------------------------------------------------------------

func TestLogin_IPRateLimited(t *testing.T) {
	h := newHarnessWithProtection(t, LoginProtection{
		IPLimiter:         ratelimit.NewMemoryLimiter(2, time.Minute),
		IdentifierLimiter: ratelimit.NoopLimiter{},
		Guard:             noopLoginGuard{},
	})
	h.register(t, "jane@example.com", "jane_doe")

	bad := LoginInput{Identifier: "jane@example.com", Password: "wrong-password"}
	ctx := context.Background()

	// Two attempts from one IP are allowed (and fail on credentials)...
	_, err := h.svc.Login(ctx, bad, ClientMeta{IP: "203.0.113.7"})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	_, err = h.svc.Login(ctx, bad, ClientMeta{IP: "203.0.113.7"})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")

	// ...the third is rate limited even with CORRECT credentials.
	_, err = h.svc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.7"})
	assertAppErr(t, err, 429, "RATE_LIMITED")

	// A different source IP is unaffected.
	if _, err := h.svc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{IP: "198.51.100.9"}); err != nil {
		t.Errorf("different IP should not be affected by another IP's limit: %v", err)
	}
}

func TestLogin_IdentifierRateLimited(t *testing.T) {
	h := newHarnessWithProtection(t, LoginProtection{
		IPLimiter:         ratelimit.NoopLimiter{},
		IdentifierLimiter: ratelimit.NewMemoryLimiter(2, time.Minute),
		Guard:             noopLoginGuard{},
	})
	h.register(t, "jane@example.com", "jane_doe")

	bad := LoginInput{Identifier: "JANE@example.com", Password: "wrong-password"} // normalized to the same key
	ctx := context.Background()

	_, err := h.svc.Login(ctx, bad, ClientMeta{IP: "203.0.113.1"})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	_, err = h.svc.Login(ctx, bad, ClientMeta{IP: "203.0.113.2"}) // different IP, same account
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")

	// The account itself is now throttled even from a fresh IP.
	_, err = h.svc.Login(ctx, bad, ClientMeta{IP: "203.0.113.3"})
	assertAppErr(t, err, 429, "RATE_LIMITED")

	// Other accounts are unaffected.
	h.register(t, "john@example.com", "john_doe")
	if _, err := h.svc.Login(ctx, LoginInput{Identifier: "john@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.3"}); err != nil {
		t.Errorf("unrelated account throttled: %v", err)
	}
}

func TestLogin_TemporaryLockoutAfterRepeatedFailures(t *testing.T) {
	clock := &loginTestClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	tracker := ratelimit.NewFailureTracker(3, 15*time.Minute, 15*time.Minute)
	tracker.Clock = clock.Now

	h := newHarnessWithProtection(t, LoginProtection{
		IPLimiter:         ratelimit.NoopLimiter{},
		IdentifierLimiter: ratelimit.NoopLimiter{},
		Guard:             tracker,
	})
	h.register(t, "jane@example.com", "jane_doe")

	bad := LoginInput{Identifier: "jane@example.com", Password: "wrong-password"}
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		_, err := h.svc.Login(ctx, bad, ClientMeta{IP: "203.0.113.7"})
		assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	}

	// Locked — even the CORRECT password is refused, with the generic
	// RATE_LIMITED error.
	_, err := h.svc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.7"})
	assertAppErr(t, err, 429, "RATE_LIMITED")

	// The lockout is temporary: after it elapses, the correct password
	// works again (never a permanent disable).
	clock.Advance(16 * time.Minute)
	res, err := h.svc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.7"})
	if err != nil {
		t.Fatalf("login after lockout expiry: %v", err)
	}
	if res.User.Username != "jane_doe" {
		t.Errorf("logged in wrong user: %+v", res.User)
	}
}

func TestLogin_SuccessResetsFailureCounters(t *testing.T) {
	h := newHarnessWithProtection(t, LoginProtection{
		IPLimiter:         ratelimit.NoopLimiter{},
		IdentifierLimiter: ratelimit.NoopLimiter{},
		Guard:             ratelimit.NewFailureTracker(3, time.Hour, time.Hour),
	})
	h.register(t, "jane@example.com", "jane_doe")

	ctx := context.Background()
	bad := LoginInput{Identifier: "jane@example.com", Password: "wrong-password"}
	good := LoginInput{Identifier: "jane@example.com", Password: "password123"}

	// Two failures, then a success that resets the counter...
	for i := 0; i < 2; i++ {
		_, err := h.svc.Login(ctx, bad, ClientMeta{})
		assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	}
	if _, err := h.svc.Login(ctx, good, ClientMeta{}); err != nil {
		t.Fatalf("successful login after failures: %v", err)
	}

	// ...so two MORE failures (4 total without the reset) still don't lock,
	// and the next correct login succeeds.
	for i := 0; i < 2; i++ {
		_, err := h.svc.Login(ctx, bad, ClientMeta{})
		assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	}
	if _, err := h.svc.Login(ctx, good, ClientMeta{}); err != nil {
		t.Errorf("pre-reset failures counted against the user after success: %v", err)
	}
}

func TestLogin_UnknownIdentifierFailuresCountTowardLockout(t *testing.T) {
	h := newHarnessWithProtection(t, LoginProtection{
		IPLimiter:         ratelimit.NoopLimiter{},
		IdentifierLimiter: ratelimit.NoopLimiter{},
		Guard:             ratelimit.NewFailureTracker(2, time.Hour, time.Hour),
	})
	ctx := context.Background()

	// Failures against a NONEXISTENT account must be recorded exactly like
	// wrong passwords — otherwise the lockout state itself would leak which
	// identifiers exist.
	ghost := LoginInput{Identifier: "ghost@example.com", Password: "whatever-1"}
	_, err := h.svc.Login(ctx, ghost, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	_, err = h.svc.Login(ctx, ghost, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")

	_, err = h.svc.Login(ctx, ghost, ClientMeta{})
	assertAppErr(t, err, 429, "RATE_LIMITED")
}

func TestLogin_RateLimitResponseIdenticalForKnownAndUnknownAccounts(t *testing.T) {
	h := newHarnessWithProtection(t, LoginProtection{
		IPLimiter:         ratelimit.NewMemoryLimiter(1, time.Minute),
		IdentifierLimiter: ratelimit.NoopLimiter{},
		Guard:             noopLoginGuard{},
	})
	h.register(t, "jane@example.com", "jane_doe")
	ctx := context.Background()

	// Exhaust the per-IP limit with a known account...
	_, err := h.svc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.7"})
	if err != nil {
		t.Fatalf("first login: %v", err)
	}
	_, known := h.svc.Login(ctx, LoginInput{Identifier: "jane@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.7"})
	_, unknown := h.svc.Login(ctx, LoginInput{Identifier: "ghost@example.com", Password: "password123"}, ClientMeta{IP: "203.0.113.7"})

	assertAppErr(t, known, 429, "RATE_LIMITED")
	assertAppErr(t, unknown, 429, "RATE_LIMITED")

	var ke, ue *apperr.Error
	errors.As(known, &ke)
	errors.As(unknown, &ue)
	if ke.Message != ue.Message {
		t.Errorf("RATE_LIMITED responses must be identical for known and unknown accounts: %q vs %q", ke.Message, ue.Message)
	}
}

// loginTestClock is a controllable clock for lockout tests (avoids sleeping).
type loginTestClock struct{ t time.Time }

func (c *loginTestClock) Now() time.Time          { return c.t }
func (c *loginTestClock) Advance(d time.Duration) { c.t = c.t.Add(d) }

// ---------------------------------------------------------------------------
// Session management (M5)
// ---------------------------------------------------------------------------

func TestListSessions_ActiveOnlyNewestFirst(t *testing.T) {
	h := newTestHarness(t)
	first := h.register(t, "jane@example.com", "jane_doe")
	second, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{UserAgent: "iPhone Safari", IP: "198.51.100.4"})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}

	// Kill the first session so only the second remains active.
	if err := h.svc.Logout(context.Background(), sessionIDOf(t, h, first)); err != nil {
		t.Fatalf("logout: %v", err)
	}

	sessions, err := h.svc.ListSessions(context.Background(), first.User.ID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("active sessions = %d, want 1 (revoked excluded)", len(sessions))
	}
	if sessions[0].ID != sessionIDOf(t, h, second) {
		t.Error("listed the wrong session")
	}
	if sessions[0].UserAgent == nil || *sessions[0].UserAgent != "iPhone Safari" {
		t.Errorf("user_agent = %v, want the login metadata", sessions[0].UserAgent)
	}
	if sessions[0].IPAddress == nil || *sessions[0].IPAddress != "198.51.100.4" {
		t.Errorf("ip_address = %v, want the login metadata", sessions[0].IPAddress)
	}
	if sessions[0].CreatedAt.IsZero() || sessions[0].ExpiresAt.IsZero() {
		t.Error("created/expires timestamps missing from session info")
	}
}

func TestRevokeSession_InvalidatesTokens(t *testing.T) {
	h := newTestHarness(t)
	first := h.register(t, "jane@example.com", "jane_doe")
	second, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}

	// The access token must authenticate BEFORE revocation — this is what
	// makes the post-revocation rejection below meaningful. The session ID
	// is captured here once; re-deriving it after revocation is impossible
	// by design (the token is dead).
	ident, err := h.svc.Authenticate(context.Background(), second.AccessToken)
	if err != nil {
		t.Fatalf("pre-revocation authenticate: %v", err)
	}
	secondSessionID := ident.SessionID

	if err := h.svc.RevokeSession(context.Background(), first.User.ID, secondSessionID); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}

	// The revoked session's access AND refresh tokens die immediately.
	_, err = h.svc.Authenticate(context.Background(), second.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")
	_, err = h.svc.Refresh(context.Background(), second.RefreshToken, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")

	// The other session is untouched.
	if _, err := h.svc.Authenticate(context.Background(), first.AccessToken); err != nil {
		t.Errorf("unrelated session was affected: %v", err)
	}

	// Revoking an already-revoked session is idempotent.
	if err := h.svc.RevokeSession(context.Background(), first.User.ID, secondSessionID); err != nil {
		t.Errorf("re-revoke should be a no-op: %v", err)
	}
}

func TestRevokeSession_ForeignSessionIsNotFound(t *testing.T) {
	h := newTestHarness(t)
	jane := h.register(t, "jane@example.com", "jane_doe")
	john := h.register(t, "john@example.com", "john_doe")

	// Jane tries to revoke John's session. The ownership scope in the store
	// makes this indistinguishable from a nonexistent session — and John's
	// session must survive.
	err := h.svc.RevokeSession(context.Background(), jane.User.ID, sessionIDOf(t, h, john))
	assertAppErr(t, err, 404, "SESSION_NOT_FOUND")

	if _, err := h.svc.Authenticate(context.Background(), john.AccessToken); err != nil {
		t.Errorf("target session was revoked across users: %v", err)
	}

	// A random UUID behaves the same way.
	err = h.svc.RevokeSession(context.Background(), jane.User.ID, uuid.New())
	assertAppErr(t, err, 404, "SESSION_NOT_FOUND")
}

func TestRevokeOtherSessions_PreservesCurrent(t *testing.T) {
	h := newTestHarness(t)
	current := h.register(t, "jane@example.com", "jane_doe")
	laptop, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}
	tablet, err := h.svc.Login(context.Background(), LoginInput{
		Identifier: "jane@example.com",
		Password:   "password123",
	}, ClientMeta{})
	if err != nil {
		t.Fatalf("third login: %v", err)
	}

	keep := sessionIDOf(t, h, current)
	if err := h.svc.RevokeOtherSessions(context.Background(), current.User.ID, keep); err != nil {
		t.Fatalf("RevokeOtherSessions: %v", err)
	}

	// Every other session is dead, access and refresh.
	for _, res := range []*AuthResult{laptop, tablet} {
		_, err := h.svc.Authenticate(context.Background(), res.AccessToken)
		assertAppErr(t, err, 401, "INVALID_TOKEN")
		_, err = h.svc.Refresh(context.Background(), res.RefreshToken, ClientMeta{})
		assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")
	}

	// The current session is untouched.
	if _, err := h.svc.Authenticate(context.Background(), current.AccessToken); err != nil {
		t.Errorf("current session was revoked by revoke-others: %v", err)
	}
	if _, err := h.svc.Refresh(context.Background(), current.RefreshToken, ClientMeta{}); err != nil {
		t.Errorf("current refresh token was revoked by revoke-others: %v", err)
	}

	// Idempotent: a second call (with only the current session left) is fine.
	if err := h.svc.RevokeOtherSessions(context.Background(), current.User.ID, keep); err != nil {
		t.Errorf("second revoke-others should be a no-op: %v", err)
	}

	// And the listing now shows exactly one active session.
	sessions, err := h.svc.ListSessions(context.Background(), current.User.ID)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 || sessions[0].ID != keep {
		t.Errorf("active sessions after revoke-others = %+v, want only the kept one", sessions)
	}
}

// ---------------------------------------------------------------------------
// JWT validation hardening (M5) — claim shape at the service boundary
// ---------------------------------------------------------------------------

// forgeJWT signs a token with arbitrary claims so tests can present tokens
// that are structurally signed-correct but malformed in their claims, or
// signed with a disallowed algorithm.
func forgeJWT(t *testing.T, method jwt.SigningMethod, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(method, claims)
	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("forge token: %v", err)
	}
	return signed
}

func validJWTClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"iss": testJWTIssuer,
		"sub": uuid.New().String(),
		"sid": uuid.New().String(),
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(15 * time.Minute).Unix(),
	}
}

func TestAuthenticate_MissingSessionClaimRejected(t *testing.T) {
	h := newTestHarness(t)
	claims := validJWTClaims()
	delete(claims, "sid")

	_, err := h.svc.Authenticate(context.Background(), forgeJWT(t, jwt.SigningMethodHS256, claims))
	assertAppErr(t, err, 401, "INVALID_TOKEN")
}

func TestAuthenticate_MissingSubjectClaimRejected(t *testing.T) {
	h := newTestHarness(t)
	claims := validJWTClaims()
	delete(claims, "sub")

	_, err := h.svc.Authenticate(context.Background(), forgeJWT(t, jwt.SigningMethodHS256, claims))
	assertAppErr(t, err, 401, "INVALID_TOKEN")
}

func TestAuthenticate_NonUUIDSessionClaimRejected(t *testing.T) {
	h := newTestHarness(t)
	claims := validJWTClaims()
	claims["sid"] = "not-a-uuid"

	_, err := h.svc.Authenticate(context.Background(), forgeJWT(t, jwt.SigningMethodHS256, claims))
	assertAppErr(t, err, 401, "INVALID_TOKEN")
}

func TestAuthenticate_WrongSigningAlgorithmRejected(t *testing.T) {
	h := newTestHarness(t)
	// Same secret, stronger algorithm: the verifier only ever accepts HS256.
	_, err := h.svc.Authenticate(context.Background(), forgeJWT(t, jwt.SigningMethodHS384, validJWTClaims()))
	assertAppErr(t, err, 401, "INVALID_TOKEN")
}

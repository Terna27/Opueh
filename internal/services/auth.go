// Package services contains business logic. The auth service owns
// registration, login, token issuance/rotation/revocation and per-request
// authentication. It depends on store interfaces (satisfied by
// repositories) so unit tests run without a database.
package services

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/ratelimit"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// AuthConfig carries the token/session lifetimes from application config.
type AuthConfig struct {
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	SessionTTL      time.Duration
}

// RegisterInput is a validated registration request.
type RegisterInput struct {
	Email       string
	Username    string
	Password    string
	DisplayName string
}

// LoginInput identifies the account by email OR username.
type LoginInput struct {
	Identifier string
	Password   string
}

// ClientMeta is request-scoped audit metadata captured by handlers.
type ClientMeta struct {
	UserAgent string
	IP        string
}

// AuthResult is the payload of register/login/refresh responses.
type AuthResult struct {
	User         *models.User
	AccessToken  string
	TokenType    string
	ExpiresIn    int64 // access token lifetime in seconds
	RefreshToken string
}

// UserStore is the persistence the auth service needs from the users
// tables. Satisfied by repositories.UserRepository.
type UserStore interface {
	CreateWithProfile(ctx context.Context, email, username, passwordHash, displayName string) (*models.User, error)
	GetByIdentifier(ctx context.Context, identifier string) (*models.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*models.User, error)
}

// SessionStore is the persistence the auth service needs from the
// sessions/refresh_tokens tables. Satisfied by repositories.SessionRepository.
type SessionStore interface {
	CreateSession(ctx context.Context, userID uuid.UUID, userAgent, ip string, expiresAt time.Time) (*models.Session, error)
	CreateRefreshToken(ctx context.Context, sessionID uuid.UUID, tokenHash string, expiresAt time.Time) error
	GetRefreshTokenState(ctx context.Context, tokenHash string) (*repositories.RefreshTokenState, error)
	RotateRefreshToken(ctx context.Context, oldTokenID uuid.UUID, newTokenHash string, newExpiresAt, now time.Time) error
	RevokeSession(ctx context.Context, sessionID uuid.UUID) error
	GetSessionAuthState(ctx context.Context, sessionID uuid.UUID) (*repositories.SessionAuthState, error)

	ListUserSessions(ctx context.Context, userID uuid.UUID) ([]models.SessionInfo, error)
	RevokeUserSession(ctx context.Context, userID, sessionID uuid.UUID) error
	RevokeOtherSessions(ctx context.Context, userID, keepSessionID uuid.UUID) error
}

// LoginGuard tracks repeated login failures and the temporary lockout that
// follows them, keyed by normalized identifier. The error returns exist so
// a Redis-backed implementation can surface infrastructure failures later;
// the in-memory ratelimit.FailureTracker satisfies this interface today.
type LoginGuard interface {
	IsLocked(ctx context.Context, key string) (bool, error)
	RecordFailure(ctx context.Context, key string) error
	Reset(ctx context.Context, key string) error
}

type noopLoginGuard struct{}

func (noopLoginGuard) IsLocked(ctx context.Context, key string) (bool, error) { return false, nil }
func (noopLoginGuard) RecordFailure(ctx context.Context, key string) error    { return nil }
func (noopLoginGuard) Reset(ctx context.Context, key string) error            { return nil }

// LoginProtection bundles the brute-force defenses around credential
// verification: fixed-window rate limits per source IP and per account
// identifier, plus a failure-count lockout. All three are interfaces so a
// Redis-backed implementation can replace the in-memory ones later without
// touching the service.
type LoginProtection struct {
	IPLimiter         ratelimit.Limiter // bounds aggregate guessing from one source
	IdentifierLimiter ratelimit.Limiter // bounds guessing at one account from many sources
	Guard             LoginGuard        // temporary lockout after repeated failures
}

// NoopLoginProtection is the do-nothing LoginProtection used by tests that
// don't exercise brute-force behavior.
func NoopLoginProtection() LoginProtection {
	return LoginProtection{
		IPLimiter:         ratelimit.NoopLimiter{},
		IdentifierLimiter: ratelimit.NoopLimiter{},
		Guard:             noopLoginGuard{},
	}
}

// AuthService implements the authentication domain.
type AuthService struct {
	users      UserStore
	sessions   SessionStore
	jwt        *auth.JWTManager
	cfg        AuthConfig
	protection LoginProtection
}

// NewAuthService constructs the service with its dependencies injected.
func NewAuthService(users UserStore, sessions SessionStore, jwt *auth.JWTManager, cfg AuthConfig, protection LoginProtection) *AuthService {
	return &AuthService{users: users, sessions: sessions, jwt: jwt, cfg: cfg, protection: protection}
}

func invalidCredentials() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid email/username or password")
}

func invalidRefreshToken() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "Invalid or expired refresh token")
}

func invalidAccessToken() *apperr.Error {
	return apperr.New(http.StatusUnauthorized, "INVALID_TOKEN", "Invalid or expired access token")
}

// Register creates a new account and immediately issues a session (the user
// is logged in on registration). Email is normalized to lowercase; username
// case is preserved (uniqueness is case-insensitive via citext).
func (s *AuthService) Register(ctx context.Context, in RegisterInput, meta ClientMeta) (*AuthResult, error) {
	email := strings.ToLower(strings.TrimSpace(in.Email))
	username := strings.TrimSpace(in.Username)
	displayName := strings.TrimSpace(in.DisplayName)
	if displayName == "" {
		displayName = username
	}

	passwordHash, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user, err := s.users.CreateWithProfile(ctx, email, username, passwordHash, displayName)
	if err != nil {
		var uve *repositories.UniqueViolationError
		if errors.As(err, &uve) {
			switch uve.Constraint {
			case "users_email_unique":
				return nil, apperr.New(http.StatusConflict, "EMAIL_ALREADY_EXISTS", "An account with this email already exists")
			case "users_username_unique":
				return nil, apperr.New(http.StatusConflict, "USERNAME_ALREADY_EXISTS", "This username is already taken")
			}
		}
		return nil, fmt.Errorf("create user: %w", err)
	}

	return s.issueSession(ctx, user, meta)
}

// Login authenticates by email or username plus password, behind the
// brute-force defenses: a per-IP rate limit, a per-identifier rate limit,
// and a temporary lockout after repeated failures. Unknown identifier and
// wrong password behave identically (including failure counting, so the
// counters themselves can't be used to enumerate accounts). Suspended or
// banned accounts are rejected explicitly after the password check.
func (s *AuthService) Login(ctx context.Context, in LoginInput, meta ClientMeta) (*AuthResult, error) {
	identifier := strings.ToLower(strings.TrimSpace(in.Identifier))

	rateLimited := apperr.New(http.StatusTooManyRequests, "RATE_LIMITED", "Too many attempts. Please try again later.")

	// Per-source-IP limit: bounds aggregate credential guessing from one
	// client regardless of which accounts it targets.
	allowed, err := s.protection.IPLimiter.Allow(ctx, "login:ip:"+meta.IP)
	if err != nil {
		return nil, fmt.Errorf("login ip limiter: %w", err)
	}
	if !allowed {
		return nil, rateLimited
	}

	// Per-identifier limit: bounds guessing at one account even when the
	// attacker rotates source IPs.
	allowed, err = s.protection.IdentifierLimiter.Allow(ctx, "login:id:"+identifier)
	if err != nil {
		return nil, fmt.Errorf("login identifier limiter: %w", err)
	}
	if !allowed {
		return nil, rateLimited
	}

	// Temporary lockout after repeated failures. Checked before any
	// credential work; the lockout never extends while active, so this can
	// never become permanent.
	guardKey := "login:lock:" + identifier
	locked, err := s.protection.Guard.IsLocked(ctx, guardKey)
	if err != nil {
		return nil, fmt.Errorf("login lockout check: %w", err)
	}
	if locked {
		return nil, rateLimited
	}

	// recordFailure counts every failed attempt identically — unknown user,
	// wrong password, unknown status — so failure counters leak nothing
	// about whether an account exists.
	recordFailure := func() error {
		if err := s.protection.Guard.RecordFailure(ctx, guardKey); err != nil {
			return fmt.Errorf("record login failure: %w", err)
		}
		return nil
	}

	user, err := s.users.GetByIdentifier(ctx, identifier)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			if recErr := recordFailure(); recErr != nil {
				return nil, recErr
			}
			return nil, invalidCredentials()
		}
		return nil, fmt.Errorf("lookup user: %w", err)
	}

	ok, err := auth.VerifyPassword(user.PasswordHash, in.Password)
	if err != nil {
		return nil, fmt.Errorf("verify password: %w", err)
	}
	if !ok || user.DeletedAt != nil {
		if recErr := recordFailure(); recErr != nil {
			return nil, recErr
		}
		return nil, invalidCredentials()
	}

	switch user.Status {
	case "ACTIVE":
	case "SUSPENDED":
		return nil, apperr.New(http.StatusForbidden, "ACCOUNT_SUSPENDED", "This account has been suspended")
	case "BANNED":
		return nil, apperr.New(http.StatusForbidden, "ACCOUNT_BANNED", "This account has been banned")
	default:
		// Unknown status is treated exactly like a bad password.
		if recErr := recordFailure(); recErr != nil {
			return nil, recErr
		}
		return nil, invalidCredentials()
	}

	result, err := s.issueSession(ctx, user, meta)
	if err != nil {
		return nil, err
	}

	// Success clears the failure state so earlier mistakes don't count
	// against the user.
	if err := s.protection.Guard.Reset(ctx, guardKey); err != nil {
		return nil, fmt.Errorf("reset login failures: %w", err)
	}
	return result, nil
}

// issueSession creates a session with its first refresh token and an
// access token.
func (s *AuthService) issueSession(ctx context.Context, user *models.User, meta ClientMeta) (*AuthResult, error) {
	now := time.Now()

	session, err := s.sessions.CreateSession(ctx, user.ID, meta.UserAgent, meta.IP, now.Add(s.cfg.SessionTTL))
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	refreshToken, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
	if err := s.sessions.CreateRefreshToken(ctx, session.ID, auth.HashToken(refreshToken), now.Add(s.cfg.RefreshTokenTTL)); err != nil {
		return nil, fmt.Errorf("store refresh token: %w", err)
	}

	accessToken, err := s.jwt.Generate(user.ID, session.ID)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	return &AuthResult{
		User:         user,
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.cfg.AccessTokenTTL.Seconds()),
		RefreshToken: refreshToken,
	}, nil
}

// Refresh rotates a refresh token: the presented token is consumed and a
// new one is issued in the same session. Presenting an already-consumed
// token is treated as theft evidence — the whole session (token family) is
// revoked. All failure modes return the same generic error to clients.
func (s *AuthService) Refresh(ctx context.Context, refreshToken string, meta ClientMeta) (*AuthResult, error) {
	state, err := s.sessions.GetRefreshTokenState(ctx, auth.HashToken(refreshToken))
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, invalidRefreshToken()
		}
		return nil, fmt.Errorf("lookup refresh token: %w", err)
	}

	now := time.Now()

	// Replay: a rotated token being presented again. Kill the family.
	if state.UsedAt != nil {
		if revErr := s.sessions.RevokeSession(ctx, state.SessionID); revErr != nil {
			return nil, fmt.Errorf("revoke session after replay: %w", revErr)
		}
		return nil, invalidRefreshToken()
	}

	dead := state.RevokedAt != nil ||
		state.ExpiresAt.Before(now) ||
		state.SessionRevokedAt != nil ||
		state.SessionExpiresAt.Before(now) ||
		state.UserDeletedAt != nil ||
		state.UserStatus != "ACTIVE"
	if dead {
		return nil, invalidRefreshToken()
	}

	newRefreshToken, err := auth.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	err = s.sessions.RotateRefreshToken(ctx, state.TokenID, auth.HashToken(newRefreshToken), now.Add(s.cfg.RefreshTokenTTL), now)
	if err != nil {
		// Lost a concurrent-rotation race: same theft signal as replay.
		if errors.Is(err, repositories.ErrTokenAlreadyUsed) {
			if revErr := s.sessions.RevokeSession(ctx, state.SessionID); revErr != nil {
				return nil, fmt.Errorf("revoke session after rotation race: %w", revErr)
			}
			return nil, invalidRefreshToken()
		}
		return nil, fmt.Errorf("rotate refresh token: %w", err)
	}

	accessToken, err := s.jwt.Generate(state.UserID, state.SessionID)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	user, err := s.users.GetByID(ctx, state.UserID)
	if err != nil {
		return nil, fmt.Errorf("load user after refresh: %w", err)
	}

	return &AuthResult{
		User:         user,
		AccessToken:  accessToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(s.cfg.AccessTokenTTL.Seconds()),
		RefreshToken: newRefreshToken,
	}, nil
}

// Logout revokes the session and all its refresh tokens. Idempotent.
func (s *AuthService) Logout(ctx context.Context, sessionID uuid.UUID) error {
	if err := s.sessions.RevokeSession(ctx, sessionID); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

// ListSessions returns the user's active sessions with their metadata.
func (s *AuthService) ListSessions(ctx context.Context, userID uuid.UUID) ([]models.SessionInfo, error) {
	sessions, err := s.sessions.ListUserSessions(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	return sessions, nil
}

// RevokeSession revokes one of the user's sessions. Ownership is enforced
// in the store (scoped by user_id), so revoking another user's session —
// or a nonexistent one — returns the same SESSION_NOT_FOUND error: no
// existence oracle. Idempotent on already-revoked sessions.
func (s *AuthService) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	if err := s.sessions.RevokeUserSession(ctx, userID, sessionID); err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return apperr.New(http.StatusNotFound, "SESSION_NOT_FOUND", "Session not found")
		}
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

// RevokeOtherSessions revokes every active session of the user except the
// current one (and their refresh tokens). Idempotent by construction.
func (s *AuthService) RevokeOtherSessions(ctx context.Context, userID, keepSessionID uuid.UUID) error {
	if err := s.sessions.RevokeOtherSessions(ctx, userID, keepSessionID); err != nil {
		return fmt.Errorf("revoke other sessions: %w", err)
	}
	return nil
}

// Authenticate validates an access token and re-derives the current
// server-side state: the session must be alive and the user active. It
// backs the auth middleware, which means logout, suspension and bans take
// effect on the very next request.
func (s *AuthService) Authenticate(ctx context.Context, accessToken string) (*models.AuthenticatedUser, error) {
	claims, err := s.jwt.Verify(accessToken)
	if err != nil {
		return nil, invalidAccessToken()
	}

	sessionID, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return nil, invalidAccessToken()
	}
	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return nil, invalidAccessToken()
	}

	state, err := s.sessions.GetSessionAuthState(ctx, sessionID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, invalidAccessToken()
		}
		return nil, fmt.Errorf("load session auth state: %w", err)
	}

	if state.UserID != userID {
		// Token's user does not own the session: treat as invalid.
		return nil, invalidAccessToken()
	}

	now := time.Now()
	if state.SessionRevokedAt != nil || state.SessionExpiresAt.Before(now) || state.UserDeletedAt != nil {
		return nil, invalidAccessToken()
	}

	switch state.Status {
	case "ACTIVE":
	case "SUSPENDED":
		return nil, apperr.New(http.StatusForbidden, "ACCOUNT_SUSPENDED", "This account has been suspended")
	case "BANNED":
		return nil, apperr.New(http.StatusForbidden, "ACCOUNT_BANNED", "This account has been banned")
	default:
		return nil, invalidAccessToken()
	}

	return &models.AuthenticatedUser{
		UserID:    state.UserID,
		SessionID: sessionID,
		Role:      state.Role,
	}, nil
}

// GetUser loads a user (with profile) by ID; used by /api/v1/me.
func (s *AuthService) GetUser(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil, apperr.New(http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		}
		return nil, fmt.Errorf("get user: %w", err)
	}
	return user, nil
}

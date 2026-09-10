package repositories

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/models"
)

// SessionRepository owns sessions and refresh_tokens.
type SessionRepository struct {
	pool *pgxpool.Pool
}

// NewSessionRepository constructs a SessionRepository.
func NewSessionRepository(pool *pgxpool.Pool) *SessionRepository {
	return &SessionRepository{pool: pool}
}

// CreateSession inserts a session row for a login. userAgent and ip are
// audit metadata; an unparseable IP is stored as NULL rather than erroring.
func (r *SessionRepository) CreateSession(ctx context.Context, userID uuid.UUID, userAgent, ip string, expiresAt time.Time) (*models.Session, error) {
	var ipArg any
	if addr, err := netip.ParseAddr(ip); err == nil {
		ipArg = addr.String()
	}

	var s models.Session
	err := r.pool.QueryRow(ctx, `
		INSERT INTO sessions (user_id, user_agent, ip_address, expires_at)
		VALUES ($1, NULLIF($2, ''), $3::inet, $4)
		RETURNING id, created_at`,
		userID, userAgent, ipArg, expiresAt,
	).Scan(&s.ID, &s.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}

	s.UserID = userID
	s.ExpiresAt = expiresAt
	return &s, nil
}

// CreateRefreshToken stores the hash of a new refresh token for a session.
func (r *SessionRepository) CreateRefreshToken(ctx context.Context, sessionID uuid.UUID, tokenHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`,
		sessionID, tokenHash, expiresAt,
	)
	if err != nil {
		return fmt.Errorf("insert refresh token: %w", err)
	}
	return nil
}

// RefreshTokenState is everything the service needs to decide whether a
// refresh token may rotate: the token's own state, its session's state, and
// the owning user's account state — read in one consistent query.
type RefreshTokenState struct {
	TokenID          uuid.UUID
	SessionID        uuid.UUID
	UserID           uuid.UUID
	UsedAt           *time.Time
	RevokedAt        *time.Time
	ExpiresAt        time.Time
	SessionRevokedAt *time.Time
	SessionExpiresAt time.Time
	UserStatus       string
	UserDeletedAt    *time.Time
}

// GetRefreshTokenState looks up a refresh token by hash, joined with its
// session and user. Returns ErrNotFound when the hash is unknown.
func (r *SessionRepository) GetRefreshTokenState(ctx context.Context, tokenHash string) (*RefreshTokenState, error) {
	var st RefreshTokenState
	err := r.pool.QueryRow(ctx, `
		SELECT t.id, t.session_id, s.user_id,
		       t.used_at, t.revoked_at, t.expires_at,
		       s.revoked_at, s.expires_at,
		       u.status, u.deleted_at
		FROM refresh_tokens t
		JOIN sessions s ON s.id = t.session_id
		JOIN users u ON u.id = s.user_id
		WHERE t.token_hash = $1`,
		tokenHash,
	).Scan(
		&st.TokenID, &st.SessionID, &st.UserID,
		&st.UsedAt, &st.RevokedAt, &st.ExpiresAt,
		&st.SessionRevokedAt, &st.SessionExpiresAt,
		&st.UserStatus, &st.UserDeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: refresh token", ErrNotFound)
		}
		return nil, fmt.Errorf("get refresh token: %w", err)
	}
	return &st, nil
}

// RotateRefreshToken atomically marks the old token used and inserts the
// new one in the same session, updating the session's last_used_at. The
// used_at guard inside the UPDATE makes rotation race-safe: a concurrent
// reuse of the same token loses and gets ErrTokenAlreadyUsed.
func (r *SessionRepository) RotateRefreshToken(ctx context.Context, oldTokenID uuid.UUID, newTokenHash string, newExpiresAt, now time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin rotation tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	tag, err := tx.Exec(ctx, `
		UPDATE refresh_tokens
		SET used_at = $1
		WHERE id = $2 AND used_at IS NULL AND revoked_at IS NULL`,
		now, oldTokenID,
	)
	if err != nil {
		return fmt.Errorf("mark old refresh token used: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrTokenAlreadyUsed
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
		VALUES ((SELECT session_id FROM refresh_tokens WHERE id = $1), $2, $3)`,
		oldTokenID, newTokenHash, newExpiresAt,
	); err != nil {
		return translatePgError(fmt.Errorf("insert rotated refresh token: %w", err))
	}

	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET last_used_at = $1
		WHERE id = (SELECT session_id FROM refresh_tokens WHERE id = $2)`,
		now, oldTokenID,
	); err != nil {
		return fmt.Errorf("update session last_used_at: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit rotation tx: %w", err)
	}
	return nil
}

// RevokeSession revokes a session and every refresh token belonging to it.
// Idempotent: revoking an already-revoked session is a no-op.
func (r *SessionRepository) RevokeSession(ctx context.Context, sessionID uuid.UUID) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin revoke tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET revoked_at = now()
		WHERE id = $1 AND revoked_at IS NULL`,
		sessionID,
	); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE session_id = $1 AND revoked_at IS NULL`,
		sessionID,
	); err != nil {
		return fmt.Errorf("revoke session refresh tokens: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit revoke tx: %w", err)
	}
	return nil
}

// SessionAuthState is the per-request auth check: the user the session
// belongs to and whether the session is still alive.
type SessionAuthState struct {
	UserID           uuid.UUID
	Role             string
	Status           string
	UserDeletedAt    *time.Time
	SessionRevokedAt *time.Time
	SessionExpiresAt time.Time
}

// GetSessionAuthState loads a session joined with its user for the auth
// middleware. Returns ErrNotFound when the session does not exist.
func (r *SessionRepository) GetSessionAuthState(ctx context.Context, sessionID uuid.UUID) (*SessionAuthState, error) {
	var st SessionAuthState
	err := r.pool.QueryRow(ctx, `
		SELECT u.id, u.role, u.status, u.deleted_at, s.revoked_at, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.id = $1`,
		sessionID,
	).Scan(
		&st.UserID, &st.Role, &st.Status,
		&st.UserDeletedAt, &st.SessionRevokedAt, &st.SessionExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: session %s", ErrNotFound, sessionID)
		}
		return nil, fmt.Errorf("get session auth state: %w", err)
	}
	return &st, nil
}

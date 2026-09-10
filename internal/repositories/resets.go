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
)

// ResetRepository owns the password_resets table and the transactional
// password-replacement flow.
type ResetRepository struct {
	pool *pgxpool.Pool
}

// NewResetRepository constructs a ResetRepository.
func NewResetRepository(pool *pgxpool.Pool) *ResetRepository {
	return &ResetRepository{pool: pool}
}

// PasswordResetState is everything the service needs to decide whether a
// reset token may be redeemed.
type PasswordResetState struct {
	TokenID       uuid.UUID
	UserID        uuid.UUID
	ExpiresAt     time.Time
	ConsumedAt    *time.Time
	UserStatus    string
	UserDeletedAt *time.Time
}

// CreatePasswordReset invalidates any still-unused reset tokens for the user
// (only the newest one is redeemable) and inserts a new token hash. The
// requesting IP is recorded for audit.
func (r *ResetRepository) CreatePasswordReset(ctx context.Context, userID uuid.UUID, tokenHash, ip string, expiresAt, now time.Time) error {
	var ipArg any
	if addr, err := netip.ParseAddr(ip); err == nil {
		ipArg = addr.String()
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin reset tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	if _, err := tx.Exec(ctx, `
		UPDATE password_resets
		SET consumed_at = $1
		WHERE user_id = $2 AND consumed_at IS NULL`,
		now, userID,
	); err != nil {
		return fmt.Errorf("supersede old reset tokens: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO password_resets (user_id, token_hash, requested_ip, expires_at)
		VALUES ($1, $2, $3::inet, $4)`,
		userID, tokenHash, ipArg, expiresAt,
	); err != nil {
		return translatePgError(fmt.Errorf("insert reset token: %w", err))
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit reset tx: %w", err)
	}
	return nil
}

// GetPasswordResetState looks up a reset token by hash, joined with its
// user. Returns ErrNotFound when the hash is unknown.
func (r *ResetRepository) GetPasswordResetState(ctx context.Context, tokenHash string) (*PasswordResetState, error) {
	var st PasswordResetState
	err := r.pool.QueryRow(ctx, `
		SELECT p.id, p.user_id, p.expires_at, p.consumed_at,
		       u.status, u.deleted_at
		FROM password_resets p
		JOIN users u ON u.id = p.user_id
		WHERE p.token_hash = $1`,
		tokenHash,
	).Scan(
		&st.TokenID, &st.UserID, &st.ExpiresAt, &st.ConsumedAt,
		&st.UserStatus, &st.UserDeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: reset token", ErrNotFound)
		}
		return nil, fmt.Errorf("get reset token: %w", err)
	}
	return &st, nil
}

// CompletePasswordReset atomically, in one transaction:
//
//  1. consumes the reset token (single-use, expiry-guarded, race-safe),
//  2. replaces the user's password hash,
//  3. revokes every session belonging to the user and all their refresh
//     tokens — anyone holding a stolen access/refresh token is logged out.
//
// This is the repository method that spans users/sessions/refresh_tokens
// because the three writes must be atomic; SQL lives in repositories
// regardless of which table it touches.
func (r *ResetRepository) CompletePasswordReset(ctx context.Context, tokenID, userID uuid.UUID, passwordHash string, now time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin password reset tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	tag, err := tx.Exec(ctx, `
		UPDATE password_resets
		SET consumed_at = $1
		WHERE id = $2 AND consumed_at IS NULL AND expires_at > $1`,
		now, tokenID,
	)
	if err != nil {
		return fmt.Errorf("consume reset token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrTokenAlreadyUsed
	}

	tag, err = tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $1, updated_at = $2
		WHERE id = $3 AND deleted_at IS NULL`,
		passwordHash, now, userID,
	)
	if err != nil {
		return fmt.Errorf("replace password: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: user %s", ErrNotFound, userID)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE sessions SET revoked_at = $1
		WHERE user_id = $2 AND revoked_at IS NULL`,
		now, userID,
	); err != nil {
		return fmt.Errorf("revoke sessions after reset: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = $1
		WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $2)
		  AND revoked_at IS NULL`,
		now, userID,
	); err != nil {
		return fmt.Errorf("revoke refresh tokens after reset: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit password reset tx: %w", err)
	}
	return nil
}

// LatestPasswordResetCreatedAt returns when the user's most recent reset
// token was created (nil if never), backing the reset-request cooldown.
func (r *ResetRepository) LatestPasswordResetCreatedAt(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var last *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT MAX(created_at) FROM password_resets WHERE user_id = $1`,
		userID,
	).Scan(&last)
	if err != nil {
		return nil, fmt.Errorf("get latest reset created_at: %w", err)
	}
	return last, nil
}

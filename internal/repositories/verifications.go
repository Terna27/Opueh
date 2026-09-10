package repositories

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VerificationRepository owns the email_verifications table.
type VerificationRepository struct {
	pool *pgxpool.Pool
}

// NewVerificationRepository constructs a VerificationRepository.
func NewVerificationRepository(pool *pgxpool.Pool) *VerificationRepository {
	return &VerificationRepository{pool: pool}
}

// EmailVerificationState is everything the service needs to decide whether a
// verification token may be redeemed, read in one consistent query.
type EmailVerificationState struct {
	TokenID         uuid.UUID
	UserID          uuid.UUID
	ExpiresAt       time.Time
	ConsumedAt      *time.Time
	UserStatus      string
	UserDeletedAt   *time.Time
	EmailVerifiedAt *time.Time
}

// CreateEmailVerification invalidates any still-unused tokens for the user
// (only the newest one is redeemable) and inserts a new token hash.
func (r *VerificationRepository) CreateEmailVerification(ctx context.Context, userID uuid.UUID, tokenHash string, expiresAt, now time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin verification tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	if _, err := tx.Exec(ctx, `
		UPDATE email_verifications
		SET consumed_at = $1
		WHERE user_id = $2 AND consumed_at IS NULL`,
		now, userID,
	); err != nil {
		return fmt.Errorf("supersede old verification tokens: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO email_verifications (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`,
		userID, tokenHash, expiresAt,
	); err != nil {
		return translatePgError(fmt.Errorf("insert verification token: %w", err))
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit verification tx: %w", err)
	}
	return nil
}

// GetEmailVerificationState looks up a verification token by hash, joined
// with its user. Returns ErrNotFound when the hash is unknown.
func (r *VerificationRepository) GetEmailVerificationState(ctx context.Context, tokenHash string) (*EmailVerificationState, error) {
	var st EmailVerificationState
	err := r.pool.QueryRow(ctx, `
		SELECT v.id, v.user_id, v.expires_at, v.consumed_at,
		       u.status, u.deleted_at, u.email_verified_at
		FROM email_verifications v
		JOIN users u ON u.id = v.user_id
		WHERE v.token_hash = $1`,
		tokenHash,
	).Scan(
		&st.TokenID, &st.UserID, &st.ExpiresAt, &st.ConsumedAt,
		&st.UserStatus, &st.UserDeletedAt, &st.EmailVerifiedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: verification token", ErrNotFound)
		}
		return nil, fmt.Errorf("get verification token: %w", err)
	}
	return &st, nil
}

// VerifyEmail atomically consumes the token and marks the user's email
// verified in one transaction. The consumed_at/expiry guard inside the UPDATE
// makes redemption single-use and race-safe: a concurrent redemption attempt
// loses and gets ErrTokenAlreadyUsed.
func (r *VerificationRepository) VerifyEmail(ctx context.Context, tokenID, userID uuid.UUID, now time.Time) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin verify email tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	tag, err := tx.Exec(ctx, `
		UPDATE email_verifications
		SET consumed_at = $1
		WHERE id = $2 AND consumed_at IS NULL AND expires_at > $1`,
		now, tokenID,
	)
	if err != nil {
		return fmt.Errorf("consume verification token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrTokenAlreadyUsed
	}

	tag, err = tx.Exec(ctx, `
		UPDATE users
		SET email_verified_at = $1
		WHERE id = $2 AND deleted_at IS NULL`,
		now, userID,
	)
	if err != nil {
		return fmt.Errorf("mark email verified: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: user %s", ErrNotFound, userID)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit verify email tx: %w", err)
	}
	return nil
}

// LatestEmailVerificationCreatedAt returns when the user's most recent
// verification token was created (nil if never), backing the resend cooldown.
func (r *VerificationRepository) LatestEmailVerificationCreatedAt(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var last *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT MAX(created_at) FROM email_verifications WHERE user_id = $1`,
		userID,
	).Scan(&last)
	if err != nil {
		return nil, fmt.Errorf("get latest verification created_at: %w", err)
	}
	return last, nil
}

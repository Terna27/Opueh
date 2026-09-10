package repositories

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/models"
)

// UserRepository owns the users and user_profiles tables.
type UserRepository struct {
	pool *pgxpool.Pool
}

// NewUserRepository constructs a UserRepository.
func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

// CreateWithProfile inserts a user and its profile in one transaction and
// returns the created user. Unique violations on email or username are
// returned as *UniqueViolationError with the constraint name.
func (r *UserRepository) CreateWithProfile(ctx context.Context, email, username, passwordHash, displayName string) (*models.User, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin create user tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	var u models.User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id, email, username, role, status, email_verified_at, created_at, updated_at`,
		email, username, passwordHash,
	).Scan(
		&u.ID, &u.Email, &u.Username, &u.Role, &u.Status,
		&u.EmailVerifiedAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, translatePgError(fmt.Errorf("insert user: %w", err))
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)`,
		u.ID, displayName,
	); err != nil {
		return nil, translatePgError(fmt.Errorf("insert user profile: %w", err))
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit create user tx: %w", err)
	}

	u.DisplayName = displayName
	return &u, nil
}

const userColumns = `
	u.id, u.email, u.username, u.password_hash, u.role, u.status,
	u.email_verified_at, u.created_at, u.updated_at, u.deleted_at,
	p.display_name`

func scanUser(row pgx.Row) (*models.User, error) {
	var u models.User
	err := row.Scan(
		&u.ID, &u.Email, &u.Username, &u.PasswordHash, &u.Role, &u.Status,
		&u.EmailVerifiedAt, &u.CreatedAt, &u.UpdatedAt, &u.DeletedAt,
		&u.DisplayName,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetByIdentifier finds a user by email OR username (citext makes both
// case-insensitive). Returns ErrNotFound when nothing matches.
func (r *UserRepository) GetByIdentifier(ctx context.Context, identifier string) (*models.User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `
		SELECT `+userColumns+`
		FROM users u
		LEFT JOIN user_profiles p ON p.user_id = u.id
		WHERE u.email = $1 OR u.username = $1`,
		identifier,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: user %q", ErrNotFound, identifier)
		}
		return nil, fmt.Errorf("get user by identifier: %w", err)
	}
	return u, nil
}

// GetByID finds a user by primary key, joined with its profile.
func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	u, err := scanUser(r.pool.QueryRow(ctx, `
		SELECT `+userColumns+`
		FROM users u
		LEFT JOIN user_profiles p ON p.user_id = u.id
		WHERE u.id = $1 AND u.deleted_at IS NULL`,
		id,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: user %s", ErrNotFound, id)
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}

// PurgeForTests hard-deletes a user (cascading to all dependents). It exists
// exclusively for integration-test cleanup.
func (r *UserRepository) PurgeForTests(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("purge user: %w", err)
	}
	return nil
}

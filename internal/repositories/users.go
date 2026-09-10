package repositories

import (
	"context"
	"errors"
	"fmt"
	"strings"

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

// ProfilePatch is a partial user_profiles update. A column is written only
// when its flag is set; the mapping from flags to column names happens
// exclusively inside UpdateProfile against this hardcoded struct — never
// from caller input. Bio is a pointer so an update can also CLEAR the bio
// (nil = SQL NULL).
type ProfilePatch struct {
	UpdateDisplayName bool
	DisplayName       string
	UpdateBio         bool
	Bio               *string
}

// profileColumns joins the account fields the profile domain needs with the
// profile row. The INNER JOIN relies on the registration invariant: every
// user is created together with its profile row in one transaction, so a
// missing profile row surfaces as ErrNotFound rather than requiring
// fallback logic anywhere upstream. p.created_at is omitted: it is the same
// instant as u.created_at (one transaction), so CreatedAt means account
// creation.
const profileColumns = `
	u.id, u.username, u.email, u.role, u.status, u.email_verified_at, u.created_at,
	p.display_name, p.bio, p.updated_at`

func scanProfile(row pgx.Row) (*models.Profile, error) {
	var p models.Profile
	err := row.Scan(
		&p.UserID, &p.Username, &p.Email, &p.Role, &p.Status,
		&p.EmailVerifiedAt, &p.CreatedAt,
		&p.DisplayName, &p.Bio, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

const profileFromUser = `
	FROM users u
	JOIN user_profiles p ON p.user_id = u.id`

// GetProfileByID loads a user's profile for the owner's eyes. Soft-deleted
// users have no profile to load.
func (r *UserRepository) GetProfileByID(ctx context.Context, userID uuid.UUID) (*models.Profile, error) {
	p, err := scanProfile(r.pool.QueryRow(ctx, `
		SELECT `+profileColumns+profileFromUser+`
		WHERE u.id = $1 AND u.deleted_at IS NULL`,
		userID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: profile for user %s", ErrNotFound, userID)
		}
		return nil, fmt.Errorf("get profile by id: %w", err)
	}
	return p, nil
}

// GetPublicProfileByUsername loads a profile for public display. citext
// makes the username match case-insensitive. Deleted, suspended and banned
// accounts are filtered in SQL, so they are indistinguishable from a
// username that never existed: one ErrNotFound, no existence oracle.
func (r *UserRepository) GetPublicProfileByUsername(ctx context.Context, username string) (*models.Profile, error) {
	p, err := scanProfile(r.pool.QueryRow(ctx, `
		SELECT `+profileColumns+profileFromUser+`
		WHERE u.username = $1 AND u.deleted_at IS NULL AND u.status = 'ACTIVE'`,
		username,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: user %q", ErrNotFound, username)
		}
		return nil, fmt.Errorf("get public profile: %w", err)
	}
	return p, nil
}

// UpdateProfile applies a partial profile update atomically — every supplied
// column changes in one statement or nothing does — and returns the updated
// profile. Only the columns whose flags are set are written; column names
// are hardcoded here, values are always bind parameters.
func (r *UserRepository) UpdateProfile(ctx context.Context, userID uuid.UUID, patch ProfilePatch) (*models.Profile, error) {
	sets := make([]string, 0, 2)
	args := make([]any, 0, 3)
	args = append(args, userID)

	if patch.UpdateDisplayName {
		args = append(args, patch.DisplayName)
		sets = append(sets, fmt.Sprintf("display_name = $%d", len(args)))
	}
	if patch.UpdateBio {
		args = append(args, patch.Bio)
		sets = append(sets, fmt.Sprintf("bio = $%d", len(args)))
	}

	if len(sets) > 0 {
		tag, err := r.pool.Exec(ctx,
			`UPDATE user_profiles SET `+strings.Join(sets, ", ")+` WHERE user_id = $1`,
			args...,
		)
		if err != nil {
			return nil, translatePgError(fmt.Errorf("update profile: %w", err))
		}
		if tag.RowsAffected() == 0 {
			// The registration invariant guarantees a profile row per user;
			// reaching this means the user does not exist (or the invariant
			// broke). Either way the caller sees not-found.
			return nil, fmt.Errorf("%w: profile for user %s", ErrNotFound, userID)
		}
	}

	return r.GetProfileByID(ctx, userID)
}

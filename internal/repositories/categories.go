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

// ErrCategoryNotFound is returned when a requested category does not exist
// (or is not selectable). It is deliberately distinct from ErrNotFound so
// services can map it to CATEGORY_NOT_FOUND without string matching.
var ErrCategoryNotFound = errors.New("category not found")

// CategoryRepository owns the categories and user_categories tables.
type CategoryRepository struct {
	pool *pgxpool.Pool
}

// NewCategoryRepository constructs a CategoryRepository.
func NewCategoryRepository(pool *pgxpool.Pool) *CategoryRepository {
	return &CategoryRepository{pool: pool}
}

// categoryColumns selects the public-safe category fields. The schema has
// no lifecycle state, so "selectable" means every category today; if a
// disabled/hidden state is added later, the WHERE clauses here are the one
// place to honor it.
const categoryColumns = `c.id, c.slug, c.name, c.description, c.created_at`

// querier is the common Query surface of the pool and a transaction, so the
// interest-listing query is written once.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanCategories(rows pgx.Rows) ([]models.Category, error) {
	defer rows.Close()

	var categories []models.Category
	for rows.Next() {
		var c models.Category
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Description, &c.CreatedAt); err != nil {
			return nil, err
		}
		categories = append(categories, c)
	}
	return categories, rows.Err()
}

// ListSelectable returns every category a user may select. The schema has
// no sort-order column, so the listing is ordered by name for a stable,
// deterministic response.
func (r *CategoryRepository) ListSelectable(ctx context.Context) ([]models.Category, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+categoryColumns+`
		FROM categories c
		ORDER BY c.name`)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	return scanCategories(rows)
}

// userInterestsQuery returns the user's selected categories, ordered by
// name so both the pool-backed read and the transactional replacement see
// and return the same deterministic order.
const userInterestsQuery = `
	SELECT ` + categoryColumns + `
	FROM categories c
	JOIN user_categories uc ON uc.category_id = c.id
	WHERE uc.user_id = $1
	ORDER BY c.name`

// ListUserInterests returns the user's current interest selection. A user
// with no selection gets an empty slice, not an error.
func (r *CategoryRepository) ListUserInterests(ctx context.Context, userID uuid.UUID) ([]models.Category, error) {
	rows, err := r.pool.Query(ctx, userInterestsQuery, userID)
	if err != nil {
		return nil, fmt.Errorf("list user interests: %w", err)
	}
	categories, err := scanCategories(rows)
	if err != nil {
		return nil, fmt.Errorf("list user interests: %w", err)
	}
	return categories, nil
}

// ReplaceUserInterests atomically replaces the user's complete interest
// selection and returns the resulting categories (ordered by name). All
// steps run in one transaction:
//
//  1. Lock the user's row (FOR UPDATE) — held until commit, this serializes
//     concurrent replacements for the same user so two requests can never
//     interleave their delete/insert phases. The composite PK on
//     user_categories backstops row-level duplicates regardless.
//  2. Validate the WHOLE requested set with one count query inside the same
//     transaction — validation cannot race with the write.
//  3. Delete the old selection, insert the new set (both set-based).
//  4. Re-select the user's interests and commit.
//
// Any failure rolls everything back: the previous selection survives
// untouched. Client values only ever travel as bind parameters.
func (r *CategoryRepository) ReplaceUserInterests(ctx context.Context, userID uuid.UUID, categoryIDs []uuid.UUID) ([]models.Category, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin replace interests tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op after a successful commit

	// Step 1: serialize concurrent replacements per user.
	var lockedUserID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
		userID,
	).Scan(&lockedUserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: user %s", ErrNotFound, userID)
		}
		return nil, fmt.Errorf("lock user for interest replacement: %w", err)
	}

	// The ID array travels as a text[] bind parameter cast to uuid[] — no
	// client value is ever interpolated into the SQL text.
	ids := make([]string, len(categoryIDs))
	for i, id := range categoryIDs {
		ids[i] = id.String()
	}

	// Step 2: one set-based validation query. A missing count means at
	// least one requested category does not exist — nothing is written.
	var found int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM categories WHERE id = ANY($1::uuid[])`,
		ids,
	).Scan(&found); err != nil {
		return nil, fmt.Errorf("validate categories: %w", err)
	}
	if found != len(ids) {
		return nil, fmt.Errorf("%w: requested %d categories, %d exist", ErrCategoryNotFound, len(ids), found)
	}

	// Step 3: out with the old, in with the new.
	if _, err := tx.Exec(ctx, `DELETE FROM user_categories WHERE user_id = $1`, userID); err != nil {
		return nil, fmt.Errorf("delete old interests: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_categories (user_id, category_id)
		SELECT $1, id FROM categories WHERE id = ANY($2::uuid[])`,
		userID, ids,
	); err != nil {
		return nil, translatePgError(fmt.Errorf("insert interests: %w", err))
	}

	// Step 4: the resulting selection, read inside the same transaction.
	rows, err := tx.Query(ctx, userInterestsQuery, userID)
	if err != nil {
		return nil, fmt.Errorf("read replaced interests: %w", err)
	}
	categories, err := scanCategories(rows)
	if err != nil {
		return nil, fmt.Errorf("read replaced interests: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit replace interests tx: %w", err)
	}
	return categories, nil
}

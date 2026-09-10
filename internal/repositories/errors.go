// Package repositories contains all database access. SQL lives here and
// only here. Repositories translate driver-level errors into the sentinel
// errors declared in this file; business meaning is attached by services.
package repositories

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is returned when a query expected to find a row finds none.
var ErrNotFound = errors.New("record not found")

// ErrTokenAlreadyUsed is returned when a refresh-token rotation is attempted
// against a token that has already been rotated — the database-level guard
// against concurrent reuse of one token.
var ErrTokenAlreadyUsed = errors.New("refresh token already used")

// UniqueViolationError reports a violated unique constraint by name, so
// services can map it to a precise API error (e.g. duplicate email).
type UniqueViolationError struct {
	Constraint string
}

func (e *UniqueViolationError) Error() string {
	return "unique constraint violation: " + e.Constraint
}

// pgUniqueViolationCode is PostgreSQL's SQLSTATE for a unique violation.
const pgUniqueViolationCode = "23505"

// translatePgError converts driver errors into repository sentinel errors,
// wrapping everything else untouched.
func translatePgError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode {
		return &UniqueViolationError{Constraint: pgErr.ConstraintName}
	}
	return err
}

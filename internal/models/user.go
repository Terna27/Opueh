// Package models holds domain structs shared across layers. Fields here map
// to database rows but carry no SQL or HTTP concerns.
package models

import (
	"time"

	"github.com/google/uuid"
)

// User is a row of the users table. DisplayName is joined from
// user_profiles on reads and set on creation.
type User struct {
	ID              uuid.UUID
	Email           string
	Username        string
	DisplayName     string
	PasswordHash    string
	Role            string
	Status          string
	EmailVerifiedAt *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       *time.Time
}

// AuthenticatedUser is the per-request identity established by the auth
// middleware: who the user is, which session they hold, and their current
// role. Handlers must trust this over anything supplied by the client.
type AuthenticatedUser struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Role      string
}

// Session is a row of the sessions table: one login, and the unit of
// revocation for the refresh tokens that belong to it.
type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
}

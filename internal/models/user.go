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

// SessionInfo is the user-facing view of a session for the
// session-management endpoints: when it was created, when it was last used,
// and the client metadata that lets a user recognize the device. It never
// carries token material — refresh tokens exist only as hashes in storage.
type SessionInfo struct {
	ID         uuid.UUID
	CreatedAt  time.Time
	LastUsedAt *time.Time
	ExpiresAt  time.Time
	UserAgent  *string
	IPAddress  *string
}

// Profile is a user_profiles row joined with the account fields the profile
// domain needs. Email, Role, Status and EmailVerifiedAt are owner-only:
// public profile representations are built by explicit whitelisting in the
// handlers and must never include them (or anything else on this struct
// that is not copied over deliberately).
//
// The struct is designed so an avatar can be added later (Milestone 8's
// media foundation) as another joined field without reshaping the domain.
type Profile struct {
	UserID          uuid.UUID
	Username        string
	DisplayName     string
	Bio             *string
	Email           string // owner-only; never in public representations
	Role            string // owner-only
	Status          string // owner-only
	EmailVerifiedAt *time.Time
	CreatedAt       time.Time // account creation (users.created_at)
	UpdatedAt       time.Time // last profile edit (user_profiles.updated_at)
}

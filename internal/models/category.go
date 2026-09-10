package models

import (
	"time"

	"github.com/google/uuid"
)

// Category is a row of the categories table: a platform-managed content
// classification. Categories are seeded by migration and administered
// database-side; there is deliberately no create/update/delete endpoint in
// this milestone. CreatedAt is internal administrative metadata and is not
// part of the public API representation.
type Category struct {
	ID          uuid.UUID
	Slug        string
	Name        string
	Description *string
	CreatedAt   time.Time
}

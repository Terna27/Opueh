package database

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/config"
)

// These tests verify the schema AS BUILT against a real database. They run
// only when TEST_DATABASE_URL is set (after `make migrate-up`):
//
//	TEST_DATABASE_URL=... go test ./internal/database/...
//
// They assert structure (tables, constraints, types) plus one behavioral
// property (cascade deletes), so a migration that silently drops a
// constraint or changes a type fails CI instead of failing in production.

func schemaTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping schema integration test")
	}

	cfg := &config.Config{
		DatabaseURL:    url,
		DBMaxConns:     2,
		DBMinConns:     1,
		DBConnLifetime: time.Minute,
		DBConnIdleTime: 30 * time.Second,
		DBHealthCheck:  30 * time.Second,
	}

	pool, err := NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

var expectedTables = []string{
	"users",
	"user_profiles",
	"sessions",
	"refresh_tokens",
	"email_verifications",
	"password_resets",
	"categories",
	"user_categories",
}

func TestSchema_AllTablesExist(t *testing.T) {
	pool := schemaTestPool(t)
	ctx := context.Background()

	for _, table := range expectedTables {
		var reg *string
		err := pool.QueryRow(ctx,
			`SELECT to_regclass('public.' || $1)`, table,
		).Scan(&reg)
		if err != nil {
			t.Fatalf("checking table %s: %v", table, err)
		}
		if reg == nil {
			t.Errorf("table %q does not exist", table)
		}
	}
}

// uniqueConstraints returns the set of unique constraint/index names for a
// table (both CONSTRAINT ... UNIQUE and CREATE UNIQUE INDEX).
//
// Two parameters are used deliberately: $1::regclass for the catalog OID
// comparison and $2 as plain text for the table name — sharing one parameter
// would force the text comparison into an invalid name = regclass operator.
func uniqueConstraints(t *testing.T, pool *pgxpool.Pool, table string) map[string]bool {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT conname FROM pg_constraint
		WHERE conrelid = $1::regclass AND contype = 'u'
		UNION
		SELECT indexname FROM pg_indexes
		WHERE schemaname = 'public' AND tablename = $2
		  AND indexdef LIKE 'CREATE UNIQUE%'`,
		"public."+table, table,
	)
	if err != nil {
		t.Fatalf("querying uniques for %s: %v", table, err)
	}
	defer rows.Close()

	names := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scanning unique name: %v", err)
		}
		names[name] = true
	}
	return names
}

func TestSchema_UniqueConstraints(t *testing.T) {
	pool := schemaTestPool(t)

	cases := map[string][]string{
		"users":               {"users_email_unique", "users_username_unique"},
		"refresh_tokens":      {"refresh_tokens_token_hash_unique"},
		"email_verifications": {"email_verifications_token_hash_unique"},
		"password_resets":     {"password_resets_token_hash_unique"},
		"categories":          {"categories_slug_unique"},
	}

	for table, want := range cases {
		uniques := uniqueConstraints(t, pool, table)
		for _, name := range want {
			if !uniques[name] {
				t.Errorf("table %s: missing unique constraint %s", table, name)
			}
		}
	}
}

func TestSchema_ForeignKeyCascades(t *testing.T) {
	pool := schemaTestPool(t)

	// pg_constraint.confdeltype codes:
	// 'a' = NO ACTION, 'r' = RESTRICT, 'c' = CASCADE,
	// 'n' = SET NULL, 'd' = SET DEFAULT
	const onDeleteCascade = "c"

	// (child table, referenced table) — every FK must be ON DELETE CASCADE.
	cases := []struct {
		Table      string
		References string
	}{
		{"user_profiles", "users"},
		{"sessions", "users"},
		{"refresh_tokens", "sessions"},
		{"email_verifications", "users"},
		{"password_resets", "users"},
		{"user_categories", "users"},
		{"user_categories", "categories"},
	}

	for _, c := range cases {
		var deleteType string
		err := pool.QueryRow(context.Background(), `
			SELECT confdeltype::text
			FROM pg_constraint
			WHERE conrelid = $1::regclass
			  AND contype = 'f'
			  AND confrelid = $2::regclass`,
			"public."+c.Table, "public."+c.References,
		).Scan(&deleteType)
		if err != nil {
			t.Fatalf("FK %s -> %s: %v", c.Table, c.References, err)
		}
		if deleteType != onDeleteCascade {
			t.Errorf("FK %s -> %s: confdeltype = %q, want %q (CASCADE)",
				c.Table, c.References, deleteType, onDeleteCascade)
		}
	}
}

func TestSchema_CheckConstraints(t *testing.T) {
	pool := schemaTestPool(t)

	cases := map[string][]string{
		"users":          {"users_role_check", "users_status_check"},
		"categories":     {"categories_slug_format"},
		"sessions":       {"sessions_expiry_check"},
		"refresh_tokens": {"refresh_tokens_expiry_check"},
	}

	for table, want := range cases {
		rows, err := pool.Query(context.Background(), `
			SELECT conname FROM pg_constraint
			WHERE conrelid = $1::regclass AND contype = 'c'`,
			"public."+table,
		)
		if err != nil {
			t.Fatalf("querying checks for %s: %v", table, err)
		}

		found := map[string]bool{}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				t.Fatalf("scan: %v", err)
			}
			found[name] = true
		}
		rows.Close()

		for _, name := range want {
			if !found[name] {
				t.Errorf("table %s: missing check constraint %s", table, name)
			}
		}
	}
}

func TestSchema_CaseInsensitiveTextColumns(t *testing.T) {
	pool := schemaTestPool(t)
	ctx := context.Background()

	cases := map[string]string{
		"users.email":    "citext",
		"users.username": "citext",
	}

	for column, wantType := range cases {
		table, col := splitColumn(column)
		var dataType string
		err := pool.QueryRow(ctx, `
			SELECT atttypid::regtype::text
			FROM pg_attribute
			WHERE attrelid = $1::regclass AND attname = $2 AND NOT attisdropped`,
			"public."+table, col,
		).Scan(&dataType)
		if err != nil {
			t.Fatalf("column %s: %v", column, err)
		}
		if dataType != wantType {
			t.Errorf("column %s: type = %s, want %s", column, dataType, wantType)
		}
	}
}

func TestSchema_InvalidRoleRejected(t *testing.T) {
	pool := schemaTestPool(t)
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		INSERT INTO users (email, username, password_hash, role)
		VALUES ($1, $2, $3, 'SUPERUSER')`,
		"check-role@example.com", "check_role_user", "x",
	)
	if err == nil {
		t.Fatal("expected CHECK constraint to reject an invalid role")
	}
}

func TestSchema_CategoriesSeeded(t *testing.T) {
	pool := schemaTestPool(t)
	ctx := context.Background()

	var count int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM categories`).Scan(&count)
	if err != nil {
		t.Fatalf("counting categories: %v", err)
	}
	if count < 10 {
		t.Errorf("expected at least 10 seeded categories, found %d", count)
	}
}

// TestSchema_UserDeleteCascades verifies the deletion behavior end to end:
// removing a user row removes its profile, sessions, tokens, verifications
// and category interests, leaving no orphans.
func TestSchema_UserDeleteCascades(t *testing.T) {
	pool := schemaTestPool(t)
	ctx := context.Background()

	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)

	var userID string
	err := pool.QueryRow(ctx, `
		INSERT INTO users (email, username, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id`,
		"cascade-test-"+suffix+"@example.com", "cascade_test_"+suffix, "hash",
	).Scan(&userID)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	// Safety net if an assertion fails before the explicit delete.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)`,
		userID, "Cascade Test",
	); err != nil {
		t.Fatalf("insert profile: %v", err)
	}

	var sessionID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO sessions (user_id, expires_at)
		VALUES ($1, now() + interval '30 days')
		RETURNING id`,
		userID,
	).Scan(&sessionID); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
		VALUES ($1, $2, now() + interval '30 days')`,
		sessionID, "cascade-hash-"+suffix,
	); err != nil {
		t.Fatalf("insert refresh token: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO email_verifications (user_id, token_hash, expires_at)
		VALUES ($1, $2, now() + interval '1 day')`,
		userID, "cascade-verify-"+suffix,
	); err != nil {
		t.Fatalf("insert email verification: %v", err)
	}

	var categoryID string
	if err := pool.QueryRow(ctx, `
		SELECT id FROM categories ORDER BY slug LIMIT 1`,
	).Scan(&categoryID); err != nil {
		t.Fatalf("select category: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_categories (user_id, category_id) VALUES ($1, $2)`,
		userID, categoryID,
	); err != nil {
		t.Fatalf("insert user category: %v", err)
	}

	// The delete under test: everything above must disappear with it.
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	counts := []struct {
		table string
		query string
		arg   string
	}{
		{"user_profiles", `SELECT count(*) FROM user_profiles WHERE user_id = $1`, userID},
		{"sessions", `SELECT count(*) FROM sessions WHERE user_id = $1`, userID},
		{"refresh_tokens", `SELECT count(*) FROM refresh_tokens WHERE session_id = $1`, sessionID},
		{"email_verifications", `SELECT count(*) FROM email_verifications WHERE user_id = $1`, userID},
		{"user_categories", `SELECT count(*) FROM user_categories WHERE user_id = $1`, userID},
	}

	for _, c := range counts {
		var count int
		if err := pool.QueryRow(ctx, c.query, c.arg).Scan(&count); err != nil {
			t.Fatalf("counting %s after delete: %v", c.table, err)
		}
		if count != 0 {
			t.Errorf("%s rows survived user deletion: %d", c.table, count)
		}
	}
}

func splitColumn(column string) (table, col string) {
	for i := len(column) - 1; i >= 0; i-- {
		if column[i] == '.' {
			return column[:i], column[i+1:]
		}
	}
	return "", column
}

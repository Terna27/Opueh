package repositories

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/database"
)

// These tests run against a real database (Neon or local) and verify the
// repositories' SQL, error translation, and transactional behavior. They are
// gated on TEST_DATABASE_URL exactly like the schema tests:
//
//	make test-db
//
// Each test creates its own users with a unique suffix and purges them via
// PurgeForTests (hard delete cascades to profiles, sessions, and tokens).

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping repository integration test")
	}

	cfg := &config.Config{
		DatabaseURL:    url,
		DBMaxConns:     2,
		DBMinConns:     1,
		DBConnLifetime: time.Minute,
		DBConnIdleTime: 30 * time.Second,
		DBHealthCheck:  30 * time.Second,
	}

	pool, err := database.NewPool(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// uniqueSuffix generates a per-run suffix so parallel test runs on a shared
// database never collide on unique constraints.
func uniqueSuffix() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

func assertUniqueViolation(t *testing.T, err error, constraint string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected unique violation on %s, got nil", constraint)
	}
	var uve *UniqueViolationError
	if !errors.As(err, &uve) {
		t.Fatalf("expected *UniqueViolationError, got %T: %v", err, err)
	}
	if uve.Constraint != constraint {
		t.Errorf("constraint = %q, want %q", uve.Constraint, constraint)
	}
}

func TestUserRepository_CreateAndDuplicates(t *testing.T) {
	pool := testPool(t)
	repo := NewUserRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	email := "alice-" + suffix + "@example.com"
	username := "alice_" + suffix

	created, err := repo.CreateWithProfile(ctx, email, username, "$argon2id$v=19$m=65536,t=1,p=2$c2FsdA$a2V5", "Alice Test")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = repo.PurgeForTests(ctx, created.ID) })

	if created.ID == uuid.Nil {
		t.Error("user ID was not generated")
	}
	if created.Role != "USER" || created.Status != "ACTIVE" {
		t.Errorf("role/status defaults wrong: %q/%q", created.Role, created.Status)
	}
	if created.Email != email || created.Username != username {
		t.Errorf("stored identifier mismatch: %q/%q", created.Email, created.Username)
	}
	if created.DisplayName != "Alice Test" {
		t.Errorf("display name = %q", created.DisplayName)
	}

	// Same email, different username.
	_, err = repo.CreateWithProfile(ctx, email, "other_"+suffix, "hash", "Other")
	assertUniqueViolation(t, err, "users_email_unique")

	// Same username, different email.
	_, err = repo.CreateWithProfile(ctx, "other-"+suffix+"@example.com", username, "hash", "Other")
	assertUniqueViolation(t, err, "users_username_unique")

	// citext: case variations must collide too.
	_, err = repo.CreateWithProfile(ctx, strings.ToUpper(email), "case_"+suffix, "hash", "Case")
	assertUniqueViolation(t, err, "users_email_unique")
}

func TestUserRepository_GetByIdentifier_CaseInsensitive(t *testing.T) {
	pool := testPool(t)
	repo := NewUserRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	email := "bob-" + suffix + "@example.com"
	username := "bob_" + suffix

	created, err := repo.CreateWithProfile(ctx, email, username, "hash", "Bob Test")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = repo.PurgeForTests(ctx, created.ID) })

	byEmail, err := repo.GetByIdentifier(ctx, strings.ToUpper(email))
	if err != nil {
		t.Fatalf("get by uppercase email: %v", err)
	}
	if byEmail.ID != created.ID {
		t.Errorf("uppercase email found user %s, want %s", byEmail.ID, created.ID)
	}

	byUsername, err := repo.GetByIdentifier(ctx, strings.ToUpper(username))
	if err != nil {
		t.Fatalf("get by uppercase username: %v", err)
	}
	if byUsername.ID != created.ID {
		t.Errorf("uppercase username found user %s, want %s", byUsername.ID, created.ID)
	}

	if _, err := repo.GetByIdentifier(ctx, "missing-"+suffix+"@example.com"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown identifier: got %v, want ErrNotFound", err)
	}

	byID, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("get by id: %v", err)
	}
	if byID.DisplayName != "Bob Test" {
		t.Errorf("profile join missing: display name = %q", byID.DisplayName)
	}
}

func TestSessionRepository_TokenLifecycle(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	sessions := NewSessionRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	user, err := users.CreateWithProfile(ctx, "carol-"+suffix+"@example.com", "carol_"+suffix, "hash", "Carol Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	// Create a session with its first refresh token.
	session, err := sessions.CreateSession(ctx, user.ID, "integration-test/1.0", "127.0.0.1", time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	firstToken, err := auth.GenerateRefreshToken()
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	firstHash := auth.HashToken(firstToken)
	if err := sessions.CreateRefreshToken(ctx, session.ID, firstHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	// The token state is initially clean and points at the right principals.
	state, err := sessions.GetRefreshTokenState(ctx, firstHash)
	if err != nil {
		t.Fatalf("get token state: %v", err)
	}
	if state.SessionID != session.ID || state.UserID != user.ID {
		t.Errorf("state principals wrong: session=%s user=%s", state.SessionID, state.UserID)
	}
	if state.UsedAt != nil || state.RevokedAt != nil {
		t.Errorf("fresh token already used/revoked: %+v", state)
	}
	if state.UserStatus != "ACTIVE" {
		t.Errorf("user status = %q", state.UserStatus)
	}

	// Rotation: old token consumed, new token usable.
	secondToken, _ := auth.GenerateRefreshToken()
	secondHash := auth.HashToken(secondToken)
	if err := sessions.RotateRefreshToken(ctx, state.TokenID, secondHash, time.Now().Add(time.Hour), time.Now()); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	oldState, err := sessions.GetRefreshTokenState(ctx, firstHash)
	if err != nil {
		t.Fatalf("get old token state: %v", err)
	}
	if oldState.UsedAt == nil {
		t.Error("rotated token was not marked used")
	}

	// Rotating the SAME old token again must fail atomically.
	thirdToken, _ := auth.GenerateRefreshToken()
	if err := sessions.RotateRefreshToken(ctx, state.TokenID, auth.HashToken(thirdToken), time.Now().Add(time.Hour), time.Now()); !errors.Is(err, ErrTokenAlreadyUsed) {
		t.Errorf("double rotation: got %v, want ErrTokenAlreadyUsed", err)
	}

	// The new token is still fresh.
	newState, err := sessions.GetRefreshTokenState(ctx, secondHash)
	if err != nil {
		t.Fatalf("get new token state: %v", err)
	}
	if newState.UsedAt != nil || newState.RevokedAt != nil {
		t.Errorf("new token marked used/revoked after double-rotation attempt: %+v", newState)
	}

	// Session auth state is alive before revocation.
	authState, err := sessions.GetSessionAuthState(ctx, session.ID)
	if err != nil {
		t.Fatalf("get session auth state: %v", err)
	}
	if authState.UserID != user.ID || authState.Status != "ACTIVE" || authState.SessionRevokedAt != nil {
		t.Errorf("auth state wrong: %+v", authState)
	}

	// Revocation kills the session and all its tokens.
	if err := sessions.RevokeSession(ctx, session.ID); err != nil {
		t.Fatalf("revoke session: %v", err)
	}
	// Idempotent.
	if err := sessions.RevokeSession(ctx, session.ID); err != nil {
		t.Fatalf("revoke session twice: %v", err)
	}

	revokedState, err := sessions.GetRefreshTokenState(ctx, secondHash)
	if err != nil {
		t.Fatalf("get revoked token state: %v", err)
	}
	if revokedState.RevokedAt == nil {
		t.Error("token not revoked after session revocation")
	}
	if revokedState.SessionRevokedAt == nil {
		t.Error("session not marked revoked")
	}

	revokedAuth, err := sessions.GetSessionAuthState(ctx, session.ID)
	if err != nil {
		t.Fatalf("get revoked session auth state: %v", err)
	}
	if revokedAuth.SessionRevokedAt == nil {
		t.Error("GetSessionAuthState did not report revocation")
	}

	// Unknown lookups surface ErrNotFound.
	if _, err := sessions.GetRefreshTokenState(ctx, auth.HashToken("rt_does-not-exist")); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown token hash: got %v, want ErrNotFound", err)
	}
	if _, err := sessions.GetSessionAuthState(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown session: got %v, want ErrNotFound", err)
	}
}

package repositories

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Tena-byte/opueh/internal/auth"
)

// These tests verify the M5 session-management repository SQL against a
// real database: listing active sessions with metadata, ownership-scoped
// revocation, and revoke-others. Gated on TEST_DATABASE_URL (make test-db).

func TestSessionRepository_ManagementLifecycle(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	sessions := NewSessionRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	user, err := users.CreateWithProfile(ctx, "sessmgmt-"+suffix+"@example.com", "sessmgmt_"+suffix, "hash", "Session Mgmt")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	other, err := users.CreateWithProfile(ctx, "other-"+suffix+"@example.com", "other_"+suffix, "hash", "Other User")
	if err != nil {
		t.Fatalf("create other user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, other.ID) })

	expires := time.Now().Add(24 * time.Hour)
	current, err := sessions.CreateSession(ctx, user.ID, "Mozilla/5.0 desktop", "203.0.113.10", expires)
	if err != nil {
		t.Fatalf("create current session: %v", err)
	}
	laptop, err := sessions.CreateSession(ctx, user.ID, "iPhone Safari", "198.51.100.7", expires)
	if err != nil {
		t.Fatalf("create laptop session: %v", err)
	}
	revoked, err := sessions.CreateSession(ctx, user.ID, "old-device", "192.0.2.1", expires)
	if err != nil {
		t.Fatalf("create soon-revoked session: %v", err)
	}
	if err := sessions.RevokeSession(ctx, revoked.ID); err != nil {
		t.Fatalf("revoke session: %v", err)
	}
	otherSession, err := sessions.CreateSession(ctx, other.ID, "other-device", "192.0.2.9", expires)
	if err != nil {
		t.Fatalf("create other user's session: %v", err)
	}

	// The laptop session gets a refresh token so revocation of tokens can
	// be observed alongside the session itself.
	laptopRefresh := "rt_" + uniqueSuffix()
	if err := sessions.CreateRefreshToken(ctx, laptop.ID, auth.HashToken(laptopRefresh), expires); err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	// Listing: only the user's ACTIVE sessions, newest first, with the
	// audit metadata — the revoked session and the other user's session
	// must not appear.
	list, err := sessions.ListUserSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserSessions: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("active sessions = %d, want 2 (revoked and foreign excluded): %+v", len(list), list)
	}
	if list[0].ID != laptop.ID || list[1].ID != current.ID {
		t.Errorf("order = [%s, %s], want newest first [laptop, current]", list[0].ID, list[1].ID)
	}
	if list[0].UserAgent == nil || *list[0].UserAgent != "iPhone Safari" {
		t.Errorf("laptop user_agent = %v, want iPhone Safari", list[0].UserAgent)
	}
	if list[0].IPAddress == nil || *list[0].IPAddress != "198.51.100.7" {
		t.Errorf("laptop ip = %v, want 198.51.100.7", list[0].IPAddress)
	}
	if list[0].LastUsedAt != nil {
		t.Errorf("laptop last_used_at = %v, want nil before any refresh", list[0].LastUsedAt)
	}

	// Cross-user revocation is indistinguishable from a nonexistent
	// session: ErrNotFound, and the target session must survive.
	err = sessions.RevokeUserSession(ctx, user.ID, otherSession.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-user revoke: got %v, want ErrNotFound", err)
	}
	otherState, err := sessions.GetSessionAuthState(ctx, otherSession.ID)
	if err != nil {
		t.Fatalf("get other session state: %v", err)
	}
	if otherState.SessionRevokedAt != nil {
		t.Error("other user's session was revoked across users")
	}

	// Revoking one of our own sessions kills it and its refresh tokens.
	if err := sessions.RevokeUserSession(ctx, user.ID, laptop.ID); err != nil {
		t.Fatalf("RevokeUserSession: %v", err)
	}
	laptopState, err := sessions.GetSessionAuthState(ctx, laptop.ID)
	if err != nil {
		t.Fatalf("get laptop state: %v", err)
	}
	if laptopState.SessionRevokedAt == nil {
		t.Error("laptop session not revoked")
	}
	refreshState, err := sessions.GetRefreshTokenState(ctx, auth.HashToken(laptopRefresh))
	if err != nil {
		t.Fatalf("get laptop refresh state: %v", err)
	}
	if refreshState.RevokedAt == nil {
		t.Error("laptop refresh token not revoked with its session")
	}

	// Idempotent: revoking it again is a no-op.
	if err := sessions.RevokeUserSession(ctx, user.ID, laptop.ID); err != nil {
		t.Errorf("re-revoke should be a no-op, got: %v", err)
	}

	// Revoke-others: a fresh third session dies, the current one survives.
	tablet, err := sessions.CreateSession(ctx, user.ID, "iPad", "198.51.100.9", expires)
	if err != nil {
		t.Fatalf("create tablet session: %v", err)
	}
	if err := sessions.RevokeOtherSessions(ctx, user.ID, current.ID); err != nil {
		t.Fatalf("RevokeOtherSessions: %v", err)
	}

	tabletState, err := sessions.GetSessionAuthState(ctx, tablet.ID)
	if err != nil {
		t.Fatalf("get tablet state: %v", err)
	}
	if tabletState.SessionRevokedAt == nil {
		t.Error("tablet session not revoked by revoke-others")
	}

	currentState, err := sessions.GetSessionAuthState(ctx, current.ID)
	if err != nil {
		t.Fatalf("get current state: %v", err)
	}
	if currentState.SessionRevokedAt != nil {
		t.Error("kept session was revoked by revoke-others")
	}

	// Idempotent.
	if err := sessions.RevokeOtherSessions(ctx, user.ID, current.ID); err != nil {
		t.Errorf("second revoke-others should be a no-op, got: %v", err)
	}

	// The listing now shows exactly the kept session.
	list, err = sessions.ListUserSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserSessions after revoke-others: %v", err)
	}
	if len(list) != 1 || list[0].ID != current.ID {
		t.Errorf("active sessions = %+v, want only the kept one", list)
	}
}

package repositories

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/auth"
)

// These tests verify the verification/reset repository SQL against a real
// database: superseding, single-use redemption, the atomic password-reset
// transaction, and cooldown lookups. Gated on TEST_DATABASE_URL (make test-db).

func TestVerificationRepository_Lifecycle(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	verifications := NewVerificationRepository(pool)
	ctx := context.Background()

	user, err := users.CreateWithProfile(ctx, "verify-"+uniqueSuffix()+"@example.com", "verify_"+uniqueSuffix(), "hash", "Verify Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	now := time.Now()
	first := "evt_" + uniqueSuffix() // opaque value; only its hash is stored
	second := "evt_" + uniqueSuffix()

	if err := verifications.CreateEmailVerification(ctx, user.ID, auth.HashToken(first), now.Add(24*time.Hour), now); err != nil {
		t.Fatalf("create first token: %v", err)
	}
	if err := verifications.CreateEmailVerification(ctx, user.ID, auth.HashToken(second), now.Add(24*time.Hour), now); err != nil {
		t.Fatalf("create second token: %v", err)
	}

	// Superseding: the first token is consumed as soon as the second exists.
	firstState, err := verifications.GetEmailVerificationState(ctx, auth.HashToken(first))
	if err != nil {
		t.Fatalf("get first state: %v", err)
	}
	if firstState.ConsumedAt == nil {
		t.Error("old verification token was not superseded")
	}

	secondState, err := verifications.GetEmailVerificationState(ctx, auth.HashToken(second))
	if err != nil {
		t.Fatalf("get second state: %v", err)
	}
	if secondState.ConsumedAt != nil {
		t.Error("new verification token already consumed")
	}
	if secondState.EmailVerifiedAt != nil {
		t.Error("user reported verified before redemption")
	}

	// Redeeming the superseded token fails atomically.
	if err := verifications.VerifyEmail(ctx, firstState.TokenID, user.ID, time.Now()); !errors.Is(err, ErrTokenAlreadyUsed) {
		t.Errorf("superseded token redeemed: got %v, want ErrTokenAlreadyUsed", err)
	}

	// Redeeming the current token marks the email verified.
	if err := verifications.VerifyEmail(ctx, secondState.TokenID, user.ID, time.Now()); err != nil {
		t.Fatalf("verify email: %v", err)
	}

	after, err := verifications.GetEmailVerificationState(ctx, auth.HashToken(second))
	if err != nil {
		t.Fatalf("get state after verify: %v", err)
	}
	if after.EmailVerifiedAt == nil {
		t.Error("email_verified_at not set after redemption")
	}
	if after.ConsumedAt == nil {
		t.Error("token not consumed after redemption")
	}

	// Double redemption is refused.
	if err := verifications.VerifyEmail(ctx, secondState.TokenID, user.ID, time.Now()); !errors.Is(err, ErrTokenAlreadyUsed) {
		t.Errorf("double redemption: got %v, want ErrTokenAlreadyUsed", err)
	}

	// Unknown hash.
	if _, err := verifications.GetEmailVerificationState(ctx, auth.HashToken("evt_unknown")); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown hash: got %v, want ErrNotFound", err)
	}

	// Cooldown lookup sees the latest token.
	latest, err := verifications.LatestEmailVerificationCreatedAt(ctx, user.ID)
	if err != nil {
		t.Fatalf("latest created_at: %v", err)
	}
	if latest == nil || latest.Before(now.Add(-time.Minute)) {
		t.Errorf("latest created_at = %v, want ~now", latest)
	}
}

func TestVerificationRepository_ExpiredTokenRefused(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	verifications := NewVerificationRepository(pool)
	ctx := context.Background()

	user, err := users.CreateWithProfile(ctx, "expired-"+uniqueSuffix()+"@example.com", "expired_"+uniqueSuffix(), "hash", "Expired Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	token := "evt_" + uniqueSuffix()
	now := time.Now()
	if err := verifications.CreateEmailVerification(ctx, user.ID, auth.HashToken(token), now.Add(24*time.Hour), now); err != nil {
		t.Fatalf("create token: %v", err)
	}

	// Expire it directly so the guarded UPDATE path is exercised. Both
	// timestamps move into the past together: the CHECK constraint
	// requires expires_at > created_at, so an expired-but-valid row is
	// one whose whole validity window already elapsed.
	if _, err := pool.Exec(ctx,
		`UPDATE email_verifications
		 SET created_at = now() - interval '2 hours',
		     expires_at = now() - interval '1 hour'
		 WHERE token_hash = $1`,
		auth.HashToken(token),
	); err != nil {
		t.Fatalf("expire token: %v", err)
	}

	state, err := verifications.GetEmailVerificationState(ctx, auth.HashToken(token))
	if err != nil {
		t.Fatalf("get state: %v", err)
	}
	if err := verifications.VerifyEmail(ctx, state.TokenID, user.ID, time.Now()); !errors.Is(err, ErrTokenAlreadyUsed) {
		t.Errorf("expired token redeemed: got %v, want ErrTokenAlreadyUsed", err)
	}
}

func TestResetRepository_Lifecycle(t *testing.T) {
	pool := testPool(t)
	users := NewUserRepository(pool)
	sessions := NewSessionRepository(pool)
	resets := NewResetRepository(pool)
	ctx := context.Background()

	suffix := uniqueSuffix()
	user, err := users.CreateWithProfile(ctx, "reset-"+suffix+"@example.com", "reset_"+suffix, "old-password-hash", "Reset Test")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = users.PurgeForTests(ctx, user.ID) })

	// Give the user a live session with a refresh token.
	session, err := sessions.CreateSession(ctx, user.ID, "reset-test", "127.0.0.1", time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	refresh := "rt_" + uniqueSuffix()
	if err := sessions.CreateRefreshToken(ctx, session.ID, auth.HashToken(refresh), time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("create refresh token: %v", err)
	}

	now := time.Now()
	first := "prt_" + uniqueSuffix()
	second := "prt_" + uniqueSuffix()
	if err := resets.CreatePasswordReset(ctx, user.ID, auth.HashToken(first), "203.0.113.9", now.Add(time.Hour), now); err != nil {
		t.Fatalf("create first reset: %v", err)
	}
	if err := resets.CreatePasswordReset(ctx, user.ID, auth.HashToken(second), "203.0.113.9", now.Add(time.Hour), now); err != nil {
		t.Fatalf("create second reset: %v", err)
	}

	// Superseding consumed the first token.
	firstState, err := resets.GetPasswordResetState(ctx, auth.HashToken(first))
	if err != nil {
		t.Fatalf("get first state: %v", err)
	}
	if firstState.ConsumedAt == nil {
		t.Error("old reset token was not superseded")
	}

	secondState, err := resets.GetPasswordResetState(ctx, auth.HashToken(second))
	if err != nil {
		t.Fatalf("get second state: %v", err)
	}

	// The atomic reset: token consumed, password replaced, sessions and
	// refresh tokens revoked — all or nothing.
	if err := resets.CompletePasswordReset(ctx, secondState.TokenID, user.ID, "new-password-hash", time.Now()); err != nil {
		t.Fatalf("complete reset: %v", err)
	}

	var newHash string
	if err := pool.QueryRow(ctx,
		`SELECT password_hash FROM users WHERE id = $1`, user.ID,
	).Scan(&newHash); err != nil {
		t.Fatalf("read password hash: %v", err)
	}
	if newHash != "new-password-hash" {
		t.Errorf("password hash = %q, want the replacement", newHash)
	}

	authState, err := sessions.GetSessionAuthState(ctx, session.ID)
	if err != nil {
		t.Fatalf("get session state: %v", err)
	}
	if authState.SessionRevokedAt == nil {
		t.Error("session not revoked after password reset")
	}

	refreshState, err := sessions.GetRefreshTokenState(ctx, auth.HashToken(refresh))
	if err != nil {
		t.Fatalf("get refresh state: %v", err)
	}
	if refreshState.RevokedAt == nil {
		t.Error("refresh token not revoked after password reset")
	}

	after, err := resets.GetPasswordResetState(ctx, auth.HashToken(second))
	if err != nil {
		t.Fatalf("get state after reset: %v", err)
	}
	if after.ConsumedAt == nil {
		t.Error("reset token not consumed")
	}

	// Double redemption is refused.
	if err := resets.CompletePasswordReset(ctx, secondState.TokenID, user.ID, "x", time.Now()); !errors.Is(err, ErrTokenAlreadyUsed) {
		t.Errorf("double redemption: got %v, want ErrTokenAlreadyUsed", err)
	}

	// Unknown hash and unknown token id. The consume guard treats an
	// unknown token like a used one (ErrTokenAlreadyUsed) — the service
	// maps both to the same client error.
	if _, err := resets.GetPasswordResetState(ctx, auth.HashToken("prt_unknown")); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown hash: got %v, want ErrNotFound", err)
	}
	if err := resets.CompletePasswordReset(ctx, uuid.New(), user.ID, "x", time.Now()); !errors.Is(err, ErrTokenAlreadyUsed) {
		t.Errorf("unknown token id: got %v, want ErrTokenAlreadyUsed", err)
	}

	// Cooldown lookup.
	latest, err := resets.LatestPasswordResetCreatedAt(ctx, user.ID)
	if err != nil {
		t.Fatalf("latest created_at: %v", err)
	}
	if latest == nil || latest.Before(now.Add(-time.Minute)) {
		t.Errorf("latest created_at = %v, want ~now", latest)
	}
}

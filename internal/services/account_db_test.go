package services

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/database"
	"github.com/Tena-byte/opueh/internal/ratelimit"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// These tests run the FULL stack over a real database — repositories,
// services, argon2 hashing, JWT — gated on TEST_DATABASE_URL (make test-db).
// They prove the milestone's end-to-end behaviors: verification flow,
// enumeration-proof reset requests, password replacement, and global session
// invalidation after a reset.

// dbSuffix generates a per-run suffix so unique constraints never collide.
func dbSuffix() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

func accountTestStack(t *testing.T) (*AuthService, *AccountService, *captureSender, func()) {
	t.Helper()

	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping account integration test")
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

	userRepo := repositories.NewUserRepository(pool)
	sessionRepo := repositories.NewSessionRepository(pool)
	verificationRepo := repositories.NewVerificationRepository(pool)
	resetRepo := repositories.NewResetRepository(pool)

	authSvc := NewAuthService(
		userRepo, sessionRepo,
		auth.NewJWTManager(testJWTSecret, testJWTIssuer, 15*time.Minute),
		AuthConfig{AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, SessionTTL: 24 * time.Hour},
		NoopLoginProtection(), // brute-force limits are not under test here
	)
	mailer := &captureSender{}
	accountSvc := NewAccountService(
		userRepo, verificationRepo, resetRepo, mailer,
		ratelimit.NoopLimiter{},
		AccountConfig{
			AppURL:                    "http://localhost:3000",
			EmailVerificationTokenTTL: 24 * time.Hour,
			PasswordResetTokenTTL:     time.Hour,
			// Long cooldowns keep resend tests deterministic.
			EmailResendCooldown:   time.Hour,
			PasswordResetCooldown: time.Hour,
		},
	)

	cleanup := func() { pool.Close() }
	return authSvc, accountSvc, mailer, cleanup
}

func TestAccountDB_EmailVerificationFlow(t *testing.T) {
	authSvc, accountSvc, mailer, cleanup := accountTestStack(t)
	defer cleanup()
	ctx := context.Background()

	email := "dbverify-" + dbSuffix() + "@example.com"
	username := "dbverify_" + dbSuffix()

	res, err := authSvc.Register(ctx, RegisterInput{
		Email: email, Username: username, Password: "password123",
	}, ClientMeta{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if res.User.EmailVerifiedAt != nil {
		t.Fatal("fresh account must not be email-verified")
	}

	// Request -> link emailed -> token redeemable.
	if err := accountSvc.RequestEmailVerification(ctx, res.User.ID); err != nil {
		t.Fatalf("request verification: %v", err)
	}
	if len(mailer.messages) != 1 {
		t.Fatalf("emails = %d, want 1", len(mailer.messages))
	}
	token := extractToken(t, mailer.messages[0].Body)

	// Resend within the cooldown is refused.
	err = accountSvc.RequestEmailVerification(ctx, res.User.ID)
	assertAppErr(t, err, 429, "RATE_LIMITED")

	// Redeem.
	if err := accountSvc.VerifyEmail(ctx, token); err != nil {
		t.Fatalf("verify email: %v", err)
	}

	user, err := authSvc.GetUser(ctx, res.User.ID)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if user.EmailVerifiedAt == nil {
		t.Error("email_verified_at not set after verification")
	}

	// Idempotent re-verification with the same, now consumed, token.
	if err := accountSvc.VerifyEmail(ctx, token); err != nil {
		t.Errorf("re-verification should be idempotent: %v", err)
	}

	// A garbage token is rejected.
	err = accountSvc.VerifyEmail(ctx, "evt_garbage")
	assertAppErr(t, err, 400, "INVALID_VERIFICATION_TOKEN")

	// Verification never blocked login, and login still works.
	if _, err := authSvc.Login(ctx, LoginInput{Identifier: email, Password: "password123"}, ClientMeta{}); err != nil {
		t.Errorf("login after verification: %v", err)
	}
}

func TestAccountDB_PasswordResetFlow(t *testing.T) {
	authSvc, accountSvc, mailer, cleanup := accountTestStack(t)
	defer cleanup()
	ctx := context.Background()

	email := "dbreset-" + dbSuffix() + "@example.com"
	username := "dbreset_" + dbSuffix()

	// Two live sessions: the registration session and a fresh login.
	res, err := authSvc.Register(ctx, RegisterInput{
		Email: email, Username: username, Password: "password123",
	}, ClientMeta{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	second, err := authSvc.Login(ctx, LoginInput{Identifier: email, Password: "password123"}, ClientMeta{})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}

	// Forgot: existing account gets mail...
	if err := accountSvc.RequestPasswordReset(ctx, email, ClientMeta{IP: "203.0.113.1"}); err != nil {
		t.Fatalf("request reset: %v", err)
	}
	// ...unknown account gets the exact same (nil) result but no mail.
	if err := accountSvc.RequestPasswordReset(ctx, "ghost-"+dbSuffix()+"@example.com", ClientMeta{IP: "203.0.113.1"}); err != nil {
		t.Fatalf("request reset for unknown email must not error: %v", err)
	}
	if len(mailer.messages) != 1 {
		t.Fatalf("emails = %d, want 1 (unknown email must not send)", len(mailer.messages))
	}
	token := extractToken(t, mailer.messages[0].Body)

	// Reset with the emailed token.
	if err := accountSvc.ResetPassword(ctx, token, "new-password-456", ClientMeta{IP: "203.0.113.1"}); err != nil {
		t.Fatalf("reset password: %v", err)
	}

	// Old password rejected; new password accepted.
	_, err = authSvc.Login(ctx, LoginInput{Identifier: email, Password: "password123"}, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_CREDENTIALS")
	fresh, err := authSvc.Login(ctx, LoginInput{Identifier: email, Password: "new-password-456"}, ClientMeta{})
	if err != nil {
		t.Fatalf("login with new password: %v", err)
	}

	// EVERY pre-reset session is dead, on both devices.
	_, err = authSvc.Authenticate(ctx, res.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")
	_, err = authSvc.Authenticate(ctx, second.AccessToken)
	assertAppErr(t, err, 401, "INVALID_TOKEN")

	// The pre-reset refresh token is dead too.
	_, err = authSvc.Refresh(ctx, res.RefreshToken, ClientMeta{})
	assertAppErr(t, err, 401, "INVALID_REFRESH_TOKEN")

	// The post-reset session (from the new-password login) is alive.
	if _, err := authSvc.Authenticate(ctx, fresh.AccessToken); err != nil {
		t.Errorf("post-reset session must be valid: %v", err)
	}

	// The reset token is single-use.
	err = accountSvc.ResetPassword(ctx, token, "another-password-789", ClientMeta{})
	assertAppErr(t, err, 400, "INVALID_RESET_TOKEN")
}

package services

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/email"
	"github.com/Tena-byte/opueh/internal/models"
	"github.com/Tena-byte/opueh/internal/ratelimit"
	"github.com/Tena-byte/opueh/internal/repositories"
)

// AccountConfig carries the email-verification and password-recovery
// settings from application config.
type AccountConfig struct {
	AppURL                    string
	EmailVerificationTokenTTL time.Duration
	PasswordResetTokenTTL     time.Duration
	EmailResendCooldown       time.Duration
	PasswordResetCooldown     time.Duration
}

// VerificationStore is the persistence the account service needs from the
// email_verifications table. Satisfied by repositories.VerificationRepository.
type VerificationStore interface {
	CreateEmailVerification(ctx context.Context, userID uuid.UUID, tokenHash string, expiresAt, now time.Time) error
	GetEmailVerificationState(ctx context.Context, tokenHash string) (*repositories.EmailVerificationState, error)
	VerifyEmail(ctx context.Context, tokenID, userID uuid.UUID, now time.Time) error
	LatestEmailVerificationCreatedAt(ctx context.Context, userID uuid.UUID) (*time.Time, error)
}

// ResetStore is the persistence the account service needs from the
// password_resets table. Satisfied by repositories.ResetRepository.
type ResetStore interface {
	CreatePasswordReset(ctx context.Context, userID uuid.UUID, tokenHash, ip string, expiresAt, now time.Time) error
	GetPasswordResetState(ctx context.Context, tokenHash string) (*repositories.PasswordResetState, error)
	CompletePasswordReset(ctx context.Context, tokenID, userID uuid.UUID, passwordHash string, now time.Time) error
	LatestPasswordResetCreatedAt(ctx context.Context, userID uuid.UUID) (*time.Time, error)
}

// AccountService implements email verification and password recovery. Its
// public contract is deliberately information-free: password-reset requests
// succeed identically whether or not the account exists, so responses can
// never be used to enumerate registered emails.
type AccountService struct {
	users         UserStore
	verifications VerificationStore
	resets        ResetStore
	mailer        email.Sender
	forgotLimiter ratelimit.Limiter // per-IP limit on password/forgot
	cfg           AccountConfig
}

// NewAccountService constructs the service with its dependencies injected.
func NewAccountService(users UserStore, verifications VerificationStore, resets ResetStore, mailer email.Sender, forgotLimiter ratelimit.Limiter, cfg AccountConfig) *AccountService {
	return &AccountService{
		users:         users,
		verifications: verifications,
		resets:        resets,
		mailer:        mailer,
		forgotLimiter: forgotLimiter,
		cfg:           cfg,
	}
}

func invalidVerificationToken() *apperr.Error {
	return apperr.New(http.StatusBadRequest, "INVALID_VERIFICATION_TOKEN", "Invalid or expired verification link")
}

func invalidResetToken() *apperr.Error {
	return apperr.New(http.StatusBadRequest, "INVALID_RESET_TOKEN", "Invalid or expired reset link")
}

func rateLimited() *apperr.Error {
	return apperr.New(http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please try again later")
}

// RequestEmailVerification issues (or re-issues) a verification token and
// emails the link. Idempotent: requesting when the email is already verified
// is a silent no-op success. Resending is cooldown-limited per user.
func (s *AccountService) RequestEmailVerification(ctx context.Context, userID uuid.UUID) error {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return apperr.New(http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		}
		return fmt.Errorf("load user for verification: %w", err)
	}

	if user.EmailVerifiedAt != nil {
		// Already verified: nothing to send, and the response must not
		// reveal verification status to make probing useless.
		return nil
	}

	now := time.Now()
	if last, err := s.verifications.LatestEmailVerificationCreatedAt(ctx, userID); err != nil {
		return fmt.Errorf("check resend cooldown: %w", err)
	} else if last != nil && now.Sub(*last) < s.cfg.EmailResendCooldown {
		return apperr.New(http.StatusTooManyRequests, "RATE_LIMITED",
			"A verification email was recently sent. Please wait before requesting another.")
	}

	token, err := auth.GenerateVerificationToken()
	if err != nil {
		return fmt.Errorf("generate verification token: %w", err)
	}

	if err := s.verifications.CreateEmailVerification(ctx, userID, auth.HashToken(token), now.Add(s.cfg.EmailVerificationTokenTTL), now); err != nil {
		return fmt.Errorf("store verification token: %w", err)
	}

	if err := s.sendVerificationEmail(ctx, user, token); err != nil {
		// The token exists but never reached the inbox; the user can
		// request again once the cooldown elapses.
		return apperr.New(http.StatusInternalServerError, "EMAIL_SEND_FAILED", "Could not send the email. Please try again later.")
	}
	return nil
}

// VerifyEmail redeems a verification token and marks the user's email
// verified. Idempotent: verifying an already-verified email succeeds without
// re-consuming anything.
func (s *AccountService) VerifyEmail(ctx context.Context, token string) error {
	state, err := s.verifications.GetEmailVerificationState(ctx, auth.HashToken(token))
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return invalidVerificationToken()
		}
		return fmt.Errorf("lookup verification token: %w", err)
	}

	// Idempotent: the email is verified, so this request has succeeded
	// regardless of which token presented it.
	if state.EmailVerifiedAt != nil {
		return nil
	}

	now := time.Now()
	if state.ConsumedAt != nil || state.ExpiresAt.Before(now) || state.UserDeletedAt != nil {
		return invalidVerificationToken()
	}

	if err := s.verifications.VerifyEmail(ctx, state.TokenID, state.UserID, now); err != nil {
		// Lost a concurrent-redeem race, or the token expired between
		// read and consume — both fail safely as invalid tokens.
		if errors.Is(err, repositories.ErrTokenAlreadyUsed) {
			return invalidVerificationToken()
		}
		if errors.Is(err, repositories.ErrNotFound) {
			return invalidVerificationToken()
		}
		return fmt.Errorf("verify email: %w", err)
	}
	return nil
}

// RequestPasswordReset emails a reset link when the account exists. It
// ALWAYS returns success (nil) for well-formed requests — the handler's
// response is identical for existing and unknown emails, making account
// enumeration via this endpoint impossible. Abuse is bounded by a per-IP
// rate limit and a silent per-user cooldown.
func (s *AccountService) RequestPasswordReset(ctx context.Context, emailAddr string, meta ClientMeta) error {
	allowed, err := s.forgotLimiter.Allow(ctx, "pwreset:ip:"+meta.IP)
	if err != nil {
		return fmt.Errorf("rate limit check: %w", err)
	}
	if !allowed {
		return rateLimited()
	}

	identifier := strings.ToLower(strings.TrimSpace(emailAddr))

	user, err := s.users.GetByIdentifier(ctx, identifier)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return nil // unknown email: same response as success
		}
		return fmt.Errorf("lookup user for reset: %w", err)
	}
	if user.DeletedAt != nil {
		return nil // deleted account: same response as success
	}

	// Per-user cooldown, enforced silently so timing/response content
	// cannot distinguish "rate limited" from "unknown email".
	now := time.Now()
	if last, err := s.resets.LatestPasswordResetCreatedAt(ctx, user.ID); err != nil {
		return fmt.Errorf("check reset cooldown: %w", err)
	} else if last != nil && now.Sub(*last) < s.cfg.PasswordResetCooldown {
		return nil
	}

	token, err := auth.GenerateResetToken()
	if err != nil {
		return fmt.Errorf("generate reset token: %w", err)
	}

	if err := s.resets.CreatePasswordReset(ctx, user.ID, auth.HashToken(token), meta.IP, now.Add(s.cfg.PasswordResetTokenTTL), now); err != nil {
		return fmt.Errorf("store reset token: %w", err)
	}

	if err := s.sendResetEmail(ctx, user, token); err != nil {
		return apperr.New(http.StatusInternalServerError, "EMAIL_SEND_FAILED", "Could not send the email. Please try again later.")
	}
	return nil
}

// ResetPassword redeems a single-use reset token, replaces the password, and
// revokes every session and refresh token for the user — a password change
// must evict all possibly-compromised credentials.
func (s *AccountService) ResetPassword(ctx context.Context, token, newPassword string, meta ClientMeta) error {
	// Defense in depth: handlers validate, but the service never trusts
	// that every caller did.
	if len(newPassword) < 8 || len(newPassword) > 128 {
		return apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", "password must be 8-128 characters")
	}

	state, err := s.resets.GetPasswordResetState(ctx, auth.HashToken(token))
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return invalidResetToken()
		}
		return fmt.Errorf("lookup reset token: %w", err)
	}

	now := time.Now()
	if state.ConsumedAt != nil || state.ExpiresAt.Before(now) || state.UserDeletedAt != nil {
		return invalidResetToken()
	}

	passwordHash, err := auth.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}

	if err := s.resets.CompletePasswordReset(ctx, state.TokenID, state.UserID, passwordHash, now); err != nil {
		if errors.Is(err, repositories.ErrTokenAlreadyUsed) || errors.Is(err, repositories.ErrNotFound) {
			return invalidResetToken()
		}
		return fmt.Errorf("complete password reset: %w", err)
	}
	return nil
}

func (s *AccountService) sendVerificationEmail(ctx context.Context, user *models.User, token string) error {
	link := fmt.Sprintf("%s/verify-email?token=%s", s.cfg.AppURL, url.QueryEscape(token))
	msg := email.Message{
		To:      user.Email,
		Subject: "Verify your email address",
		Body: fmt.Sprintf(
			"Hi %s,\n\nConfirm your email address to finish setting up your Opueh account:\n\n%s\n\nThis link expires in %s and can only be used once. If you did not create an account, you can ignore this email.\n",
			user.DisplayName, link, s.cfg.EmailVerificationTokenTTL,
		),
	}
	return s.mailer.Send(ctx, msg)
}

func (s *AccountService) sendResetEmail(ctx context.Context, user *models.User, token string) error {
	link := fmt.Sprintf("%s/reset-password?token=%s", s.cfg.AppURL, url.QueryEscape(token))
	msg := email.Message{
		To:      user.Email,
		Subject: "Reset your password",
		Body: fmt.Sprintf(
			"Hi %s,\n\nWe received a request to reset your Opueh password. You can set a new one here:\n\n%s\n\nThis link expires in %s and can only be used once. Resetting your password signs you out everywhere. If you did not request this, your account is safe — you can ignore this email.\n",
			user.DisplayName, link, s.cfg.PasswordResetTokenTTL,
		),
	}
	return s.mailer.Send(ctx, msg)
}

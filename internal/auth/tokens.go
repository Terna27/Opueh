package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// Token prefixes distinguish token types if they are ever mixed in logs or
// storage — a verification token can never be replayed as a reset token, and
// vice versa, because lookups are per-table and the prefixes make accidental
// cross-use obvious.
const (
	refreshTokenPrefix      = "rt_"
	verificationTokenPrefix = "evt_"
	resetTokenPrefix        = "prt_"
)

// GenerateToken returns a new opaque token: prefix followed by 256 bits of
// crypto/rand entropy, base64url-encoded. Only its SHA-256 hash (see
// HashToken) is ever stored server-side; the plaintext exists once, in the
// response or email that delivers it to the client.
func GenerateToken(prefix string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate %stoken: %w", prefix, err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken returns the SHA-256 hex digest of an opaque token — the exact
// value stored in *_token.token_hash columns and used for lookups.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// GenerateRefreshToken returns a new refresh token ("rt_...").
func GenerateRefreshToken() (string, error) {
	return GenerateToken(refreshTokenPrefix)
}

// GenerateVerificationToken returns a new email-verification token ("evt_...").
func GenerateVerificationToken() (string, error) {
	return GenerateToken(verificationTokenPrefix)
}

// GenerateResetToken returns a new password-reset token ("prt_...").
func GenerateResetToken() (string, error) {
	return GenerateToken(resetTokenPrefix)
}

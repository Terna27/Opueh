package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// refreshTokenPrefix distinguishes refresh tokens from other token types if
// they are ever mixed in logs or storage.
const refreshTokenPrefix = "rt_"

// GenerateRefreshToken returns a new opaque refresh token: "rt_" followed by
// 256 bits of crypto/rand entropy, base64url-encoded (51 chars total).
// Only its SHA-256 hash is ever stored server-side; the plaintext exists
// once, in the response that delivers it to the client.
func GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate refresh token: %w", err)
	}
	return refreshTokenPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// HashRefreshToken returns the SHA-256 hex digest of a refresh token, the
// exact value stored in refresh_tokens.token_hash and used for lookups.
func HashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

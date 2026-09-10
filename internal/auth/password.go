// Package auth contains authentication primitives: password hashing
// (argon2id), cryptographically secure refresh token generation and hashing,
// and JWT access token issuing/verification. It has no knowledge of HTTP,
// services or repositories.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters. Memory-hard: an attacker must spend ~64 MiB per
// guess, which makes GPU cracking dramatically more expensive. Parameters
// are stored alongside each hash in PHC format, so they can be raised later
// without invalidating existing hashes.
const (
	argonTime    = 1         // iterations
	argonMemory  = 64 * 1024 // KiB (64 MiB)
	argonThreads = 2         // parallelism
	argonSaltLen = 16        // bytes
	argonKeyLen  = 32        // bytes
)

// HashPassword hashes a password with argon2id and returns the encoded PHC
// string: $argon2id$v=19$m=65536,t=1,p=2$<salt>$<key>.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword reports whether password matches the encoded argon2id
// hash. It recomputes the hash using the parameters embedded in the encoded
// string and compares in constant time. Malformed encoded strings return an
// error rather than a silent false, so a corrupted hash row is visible.
func VerifyPassword(encoded, password string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, key]
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false, fmt.Errorf("malformed password hash")
	}

	if !strings.HasPrefix(parts[2], "v=") {
		return false, fmt.Errorf("malformed password hash version")
	}
	version, err := strconv.ParseUint(parts[2][2:], 10, 32)
	if err != nil {
		return false, fmt.Errorf("malformed password hash version: %w", err)
	}

	params := strings.Split(parts[3], ",")
	if len(params) != 3 {
		return false, fmt.Errorf("malformed password hash parameters")
	}
	var m, t, p uint64
	for _, param := range params {
		value, err := strconv.ParseUint(param[2:], 10, 32)
		if err != nil {
			return false, fmt.Errorf("malformed password hash parameter %q: %w", param, err)
		}
		switch param[:2] {
		case "m=":
			m = value
		case "t=":
			t = value
		case "p=":
			p = value
		default:
			return false, fmt.Errorf("unknown password hash parameter %q", param[:2])
		}
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("malformed password hash salt: %w", err)
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("malformed password hash key: %w", err)
	}
	if len(expected) == 0 {
		return false, fmt.Errorf("empty password hash key")
	}

	if p == 0 || p > 255 {
		return false, fmt.Errorf("invalid argon2 parallelism %d", p)
	}

	if version != argon2.Version {
		// Unknown argon2 version: refuse rather than verify incorrectly.
		return false, fmt.Errorf("unsupported argon2 version %d", version)
	}

	key := argon2.IDKey(
		[]byte(password),
		salt,
		uint32(t),
		uint32(m),
		uint8(p),
		uint32(len(expected)),
	)

	return subtle.ConstantTimeCompare(key, expected) == 1, nil
}

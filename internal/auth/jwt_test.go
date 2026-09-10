package auth

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const testSecret = "test-secret-that-is-at-least-32-bytes-long!"

func TestJWT_RoundTrip(t *testing.T) {
	m := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)
	userID := uuid.New()
	sessionID := uuid.New()

	token, err := m.Generate(userID, sessionID)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	claims, err := m.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if claims.Subject != userID.String() {
		t.Errorf("sub = %q, want %q", claims.Subject, userID)
	}
	if claims.SessionID != sessionID.String() {
		t.Errorf("sid = %q, want %q", claims.SessionID, sessionID)
	}
	if claims.Issuer != "opueh-test" {
		t.Errorf("iss = %q, want opueh-test", claims.Issuer)
	}
	if claims.ExpiresAt == nil || claims.ExpiresAt.Time.Before(time.Now()) {
		t.Error("exp missing or already in the past")
	}
}

func TestJWT_ExpiredTokenRejected(t *testing.T) {
	m := NewJWTManager(testSecret, "opueh-test", -time.Hour)

	token, err := m.Generate(uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	if _, err := m.Verify(token); err == nil {
		t.Error("expired token was accepted")
	}
}

func TestJWT_WrongSecretRejected(t *testing.T) {
	signer := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)
	verifier := NewJWTManager("another-secret-that-is-32-bytes-long!", "opueh-test", 15*time.Minute)

	token, err := signer.Generate(uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	if _, err := verifier.Verify(token); err == nil {
		t.Error("token signed with a different key was accepted")
	}
}

func TestJWT_WrongIssuerRejected(t *testing.T) {
	signer := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)
	verifier := NewJWTManager(testSecret, "someone-else", 15*time.Minute)

	token, err := signer.Generate(uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	if _, err := verifier.Verify(token); err == nil {
		t.Error("token from a different issuer was accepted")
	}
}

func TestJWT_GarbageRejected(t *testing.T) {
	m := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)

	for _, token := range []string{"", "garbage", "a.b.c.d"} {
		if _, err := m.Verify(token); err == nil {
			t.Errorf("garbage token %q was accepted", token)
		}
	}
}

// TestJWT_AlgNoneRejected forges a token with alg=none to confirm the
// verifier refuses tokens that carry no valid signature.
func TestJWT_AlgNoneRejected(t *testing.T) {
	m := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(
		`{"sid":"` + uuid.New().String() + `","iss":"opueh-test","exp":9999999999}`,
	))
	forged := header + "." + payload + "."

	if _, err := m.Verify(forged); err == nil {
		t.Error("alg=none token was accepted")
	}
	if _, err := m.Verify(strings.TrimSuffix(forged, ".")); err == nil {
		t.Error("alg=none token without signature separator was accepted")
	}
}

// TestJWT_WrongAlgorithmRejected forges an HS384 token signed with the same
// secret: only HS256 is ever accepted, regardless of key validity.
func TestJWT_WrongAlgorithmRejected(t *testing.T) {
	m := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)

	claims := jwt.MapClaims{
		"sub": uuid.New().String(),
		"sid": uuid.New().String(),
		"iss": "opueh-test",
		"exp": time.Now().Add(15 * time.Minute).Unix(),
	}
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS384, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("forge HS384 token: %v", err)
	}

	if _, err := m.Verify(forged); err == nil {
		t.Error("HS384 token signed with the correct secret was accepted")
	}
}

// TestJWT_MissingExpiryRejected forges a structurally valid token with no
// exp claim: expiry is mandatory, not optional.
func TestJWT_MissingExpiryRejected(t *testing.T) {
	m := NewJWTManager(testSecret, "opueh-test", 15*time.Minute)

	claims := jwt.MapClaims{
		"sub": uuid.New().String(),
		"sid": uuid.New().String(),
		"iss": "opueh-test",
		"iat": time.Now().Unix(),
	}
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("forge no-exp token: %v", err)
	}

	if _, err := m.Verify(forged); err == nil {
		t.Error("token without an exp claim was accepted")
	}
}

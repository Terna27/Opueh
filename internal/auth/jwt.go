package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims are the access-token claims. Deliberately minimal: identity (sub),
// session (sid) and standard bookkeeping. Role and status are NEVER carried
// here — they are re-read from the database on every request so suspensions
// and role changes take effect immediately.
type Claims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

// JWTManager issues and verifies HS256 access tokens.
type JWTManager struct {
	secret []byte
	issuer string
	ttl    time.Duration
}

// NewJWTManager constructs a JWTManager. secret must be at least 32 bytes.
func NewJWTManager(secret, issuer string, ttl time.Duration) *JWTManager {
	return &JWTManager{secret: []byte(secret), issuer: issuer, ttl: ttl}
}

// Generate signs a new access token for the given user and session.
func (m *JWTManager) Generate(userID, sessionID uuid.UUID) (string, error) {
	now := time.Now()
	claims := Claims{
		SessionID: sessionID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// Verify validates signature, algorithm, issuer and expiry, returning the
// claims. Only HS256 is accepted — any other algorithm, including "none",
// is rejected.
func (m *JWTManager) Verify(tokenString string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		return m.secret, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(m.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("verify access token: %w", err)
	}
	return claims, nil
}

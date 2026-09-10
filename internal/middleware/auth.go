package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/models"
)

// Authenticator is the service surface required to authenticate requests.
// *services.AuthService satisfies it; tests use stubs.
type Authenticator interface {
	Authenticate(ctx context.Context, accessToken string) (*models.AuthenticatedUser, error)
}

type authContextKey struct{}

// RequireAuth protects routes. It extracts the bearer token, delegates to
// the authenticator (which re-derives user/session state from the
// database), and exposes the identity to downstream handlers via
// UserFromContext.
func RequireAuth(authenticator Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			if token == "" {
				apperr.WriteError(w, r, apperr.New(
					http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication required",
				))
				return
			}

			user, err := authenticator.Authenticate(r.Context(), token)
			if err != nil {
				apperr.WriteError(w, r, err)
				return
			}

			ctx := context.WithValue(r.Context(), authContextKey{}, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserFromContext returns the authenticated identity established by
// RequireAuth, or nil if the request was not authenticated.
func UserFromContext(ctx context.Context) *models.AuthenticatedUser {
	user, _ := ctx.Value(authContextKey{}).(*models.AuthenticatedUser)
	return user
}

// bearerToken extracts the token from an "Authorization: Bearer <token>"
// header (scheme matched case-insensitively per RFC 7235).
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

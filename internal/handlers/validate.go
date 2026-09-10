package handlers

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strings"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/services"
)

var (
	emailRegex    = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_]{3,30}$`)
)

// decodeJSON parses a request body into dst, rejecting unknown fields and
// oversized bodies with precise API errors.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return apperr.RequestTooLarge("Request body exceeds the allowed size")
		}
		return apperr.New(http.StatusBadRequest, "INVALID_JSON", "Request body is not valid JSON or contains unknown fields")
	}
	return nil
}

// clientMeta extracts audit metadata from the request.
func clientMeta(r *http.Request) services.ClientMeta {
	return services.ClientMeta{
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
	}
}

// clientIP returns the remote address without its port.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// validateRegistration checks registration input shape. Business rules
// (uniqueness, account state) live in the service.
func validateRegistration(email, username, password, displayName string) error {
	var problems []string

	email = strings.TrimSpace(email)
	switch {
	case email == "":
		problems = append(problems, "email is required")
	case len(email) > 254:
		problems = append(problems, "email must be at most 254 characters")
	case !emailRegex.MatchString(email):
		problems = append(problems, "email is not a valid email address")
	}

	username = strings.TrimSpace(username)
	switch {
	case username == "":
		problems = append(problems, "username is required")
	case !usernameRegex.MatchString(username):
		problems = append(problems, "username must be 3-30 characters (letters, digits, underscores)")
	}

	switch {
	case len(password) < 8:
		problems = append(problems, "password must be at least 8 characters")
	case len(password) > 128:
		problems = append(problems, "password must be at most 128 characters")
	}

	displayName = strings.TrimSpace(displayName)
	if displayName != "" && len(displayName) > 50 {
		problems = append(problems, "display_name must be at most 50 characters")
	}

	if len(problems) > 0 {
		return apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", strings.Join(problems, "; "))
	}
	return nil
}

// validateLogin checks login input shape.
func validateLogin(identifier, password string) error {
	var problems []string

	if strings.TrimSpace(identifier) == "" {
		problems = append(problems, "identifier is required")
	}
	if password == "" {
		problems = append(problems, "password is required")
	}

	if len(problems) > 0 {
		return apperr.New(http.StatusBadRequest, "VALIDATION_ERROR", strings.Join(problems, "; "))
	}
	return nil
}

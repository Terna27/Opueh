// Package apperr defines the centralized API error model. Every error
// response produced by this service has the same JSON shape:
//
//	{
//	  "error": {
//	    "code": "INVALID_CREDENTIALS",
//	    "message": "Invalid email or password"
//	  }
//	}
//
// Unknown errors collapse to a generic INTERNAL response; the underlying
// cause must be logged by the caller and is never exposed to clients.
package apperr

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Error is an error that is safe and meaningful to return to an API client.
// Code is stable and machine-readable; Message is safe for display.
type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error implements the error interface.
func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

// New constructs an Error with an explicit HTTP status, code and message.
func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// Internal returns a generic 500. Details belong in logs, not responses.
func Internal(message string) *Error {
	return New(http.StatusInternalServerError, "INTERNAL", message)
}

// NotFound returns a 404 for a missing resource or route.
func NotFound(message string) *Error {
	return New(http.StatusNotFound, "NOT_FOUND", message)
}

// MethodNotAllowed returns a 405.
func MethodNotAllowed(message string) *Error {
	return New(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", message)
}

// RequestTooLarge returns a 413.
func RequestTooLarge(message string) *Error {
	return New(http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", message)
}

// WriteError renders err to the client in the standard error shape. Errors
// that are not *Error are replaced with a generic INTERNAL response so that
// internal failures (database errors, panics, etc.) never leak details.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var appErr *Error
	if !errors.As(err, &appErr) {
		appErr = Internal("An unexpected error occurred")
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(appErr.Status)

	// Encoding failures at this point cannot be meaningfully handled; the
	// status code and partial body have already been sent.
	_ = json.NewEncoder(w).Encode(map[string]*Error{"error": appErr})
}

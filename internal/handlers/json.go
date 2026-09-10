package handlers

import (
	"encoding/json"
	"net/http"
)

// writeJSON serializes a successful response body. Encoding failures after
// the status line has been written cannot be meaningfully handled; the error
// is deliberately ignored for success payloads (error responses go through
// apperr.WriteError).
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

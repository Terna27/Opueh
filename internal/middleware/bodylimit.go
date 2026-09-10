package middleware

import (
	"net/http"

	"github.com/Tena-byte/opueh/internal/apperr"
)

// BodyLimit caps the size of request bodies. Requests that declare a
// Content-Length above the limit are rejected immediately with 413; requests
// without a declared length (chunked encoding) are capped mid-stream by
// http.MaxBytesReader.
func BodyLimit(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if limit <= 0 {
				next.ServeHTTP(w, r)
				return
			}

			if r.ContentLength > limit {
				apperr.WriteError(w, r, apperr.RequestTooLarge(
					"Request body exceeds the allowed size",
				))
				return
			}

			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

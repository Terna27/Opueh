package middleware

import "net/http"

// SecurityHeaders sets defensive browser-facing response headers on every
// response:
//
//	X-Content-Type-Options: nosniff — browsers must not MIME-sniff responses
//	X-Frame-Options: DENY     — the API must never be framed
//	Referrer-Policy: no-referrer — no URL/context leaks to third parties
//	X-XSS-Protection: 0      — disable the legacy, itself-vulnerable auditor
//
// In production it additionally sets HSTS: clients should only ever reach
// the API over TLS, and must remember that for a year. HSTS is omitted in
// local/staging because plain HTTP must keep working there, and an HSTS
// header received over HTTP is ignored by browsers anyway.
func SecurityHeaders(production bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()

			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("X-XSS-Protection", "0")

			if production {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}

			next.ServeHTTP(w, r)
		})
	}
}

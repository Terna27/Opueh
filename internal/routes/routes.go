// Package routes defines the URL structure and the middleware stack applied
// to every request. Handlers are constructed here and wired to routes; this
// is the only package (besides cmd/api) that knows how the layers fit
// together.
package routes

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Tena-byte/opueh/internal/apperr"
	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/handlers"
	appmiddleware "github.com/Tena-byte/opueh/internal/middleware"
	"github.com/Tena-byte/opueh/internal/services"
)

// Deps carries the runtime dependencies the router needs. It grows as
// milestones add services; each service is injected, never constructed from
// global state.
type Deps struct {
	Config      *config.Config
	Logger      *slog.Logger
	DB          *pgxpool.Pool
	AuthService *services.AuthService
}

// NewRouter builds the application router with the full middleware stack.
//
// Middleware order matters:
//
//	RequestID  — assign an ID before anything logs
//	Logger     — one structured line per request (sees Recoverer's 500s)
//	Recoverer  — inside Logger so panics are logged as failing requests
//	BodyLimit  — reject oversized payloads before handlers run
//	CORS       — outermost behavior for preflight responses
func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(appmiddleware.RequestID)
	r.Use(appmiddleware.Logger(deps.Logger))
	r.Use(appmiddleware.Recoverer(deps.Logger))
	r.Use(appmiddleware.BodyLimit(deps.Config.RequestBodyLimitBytes))
	r.Use(appmiddleware.CORS(deps.Config.AllowedOrigins))

	// Infrastructure probes: deliberately unversioned and outside /api.
	health := handlers.NewHealthHandler(deps.DB, deps.Logger, deps.Config.ReadyCheckDelay)
	r.Get("/health", health.Health)
	r.Get("/ready", health.Ready)

	authHandler := handlers.NewAuthHandler(deps.AuthService)
	meHandler := handlers.NewMeHandler(deps.AuthService)
	requireAuth := appmiddleware.RequireAuth(deps.AuthService)

	r.Route("/api/v1", func(v1 chi.Router) {
		v1.Route("/auth", func(a chi.Router) {
			a.Post("/register", authHandler.Register)
			a.Post("/login", authHandler.Login)
			a.Post("/refresh", authHandler.Refresh)
			a.Group(func(protected chi.Router) {
				protected.Use(requireAuth)
				protected.Post("/logout", authHandler.Logout)
			})
		})

		v1.Group(func(protected chi.Router) {
			protected.Use(requireAuth)
			protected.Get("/me", meHandler.Me)
		})
	})

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		apperr.WriteError(w, r, apperr.NotFound("The requested resource does not exist"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		apperr.WriteError(w, r, apperr.MethodNotAllowed("The request method is not allowed for this resource"))
	})

	return r
}

// Command api is the Opueh backend API server. It is the composition root:
// it loads configuration, builds the logger and database pool, wires the
// repositories, services and router, and manages the server lifecycle
// including graceful shutdown.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/Tena-byte/opueh/internal/auth"
	"github.com/Tena-byte/opueh/internal/config"
	"github.com/Tena-byte/opueh/internal/database"
	"github.com/Tena-byte/opueh/internal/observability"
	"github.com/Tena-byte/opueh/internal/repositories"
	"github.com/Tena-byte/opueh/internal/routes"
	"github.com/Tena-byte/opueh/internal/services"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Default().Error("fatal", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := observability.NewLogger(cfg)

	// Signals cancel this context; everything below respects it so a
	// shutdown is not blocked by an in-flight startup step.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPool(ctx, cfg)
	if err != nil {
		logger.Error("database_connection_failed", "error", err.Error())
		return err
	}
	defer pool.Close()

	// Dependency wiring: repositories <- pool, services <- repositories,
	// handlers/router <- services.
	userRepo := repositories.NewUserRepository(pool)
	sessionRepo := repositories.NewSessionRepository(pool)
	jwtManager := auth.NewJWTManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.AccessTokenTTL)
	authService := services.NewAuthService(userRepo, sessionRepo, jwtManager, services.AuthConfig{
		AccessTokenTTL:  cfg.AccessTokenTTL,
		RefreshTokenTTL: cfg.RefreshTokenTTL,
		SessionTTL:      cfg.SessionTTL,
	})

	router := routes.NewRouter(routes.Deps{
		Config:      cfg,
		Logger:      logger,
		DB:          pool,
		AuthService: authService,
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	// Serve until the context is cancelled or the listener fails.
	serverErr := make(chan error, 1)
	go func() {
		logger.Info("server_started",
			"addr", cfg.HTTPAddr,
			"env", string(cfg.Environment),
			"version", version,
		)
		serverErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err

	case <-ctx.Done():
		logger.Info("shutdown_signal_received")
	}

	// Give in-flight requests a bounded window to complete, then exit.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful_shutdown_failed", "error", err.Error())
		return err
	}

	pool.Close()
	logger.Info("shutdown_complete")
	return nil
}

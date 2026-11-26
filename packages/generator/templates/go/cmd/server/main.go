package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"example.com/factory/application/internal/httpapp"
	"example.com/factory/application/internal/platform"
	"github.com/gin-gonic/gin"
)

func run(log *slog.Logger) error {
	address, err := platform.Address()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	pool, err := platform.Connect(ctx)
	if err != nil {
		return errors.New("database configuration could not be loaded")
	}
	if pool != nil {
		defer pool.Close()
	}
	gin.SetMode(gin.ReleaseMode)
	web := httpapp.New(pool, "dist/web", log)
	srv := &http.Server{Addr: address, Handler: web, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	stopped := make(chan error, 1)
	go func() { stopped <- srv.ListenAndServe() }()
	log.Info("listening", "address", address)
	select {
	case err := <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP server could not listen")
		}
	case <-ctx.Done():
		drain, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if err := srv.Shutdown(drain); err != nil {
			_ = srv.Close()
			return errors.New("HTTP shutdown exceeded its deadline")
		}
	}
	return nil
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error(err.Error())
		os.Exit(1)
	}
}

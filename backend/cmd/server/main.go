package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"margin/internal/app"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run(args []string) error {
	flags := flag.NewFlagSet("server", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	healthcheck := flags.Bool("healthcheck", false, "check the local health endpoint and exit")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return errors.New("invalid command-line arguments")
	}
	if *healthcheck {
		port, err := loadPort()
		if err != nil {
			return err
		}
		return checkHealth(context.Background(), port)
	}
	config, err := loadConfig()
	if err != nil {
		return err
	}
	fetcher, err := app.NewFetcherWithConfig(config.fetcher)
	if err != nil {
		return err
	}
	defer fetcher.Close()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	var store *app.Store
	startup, cancelStartup := context.WithTimeout(ctx, 60*time.Second)
	defer cancelStartup()
	for attempt := 1; ; attempt++ {
		store, err = app.OpenStore(startup, config.databaseURL)
		if err == nil {
			break
		}
		if startup.Err() != nil {
			return errors.New("database unavailable after startup retry window")
		}
		slog.Warn("waiting for database", "attempt", attempt)
		select {
		case <-startup.Done():
			return errors.New("database startup interrupted")
		case <-time.After(2 * time.Second):
		}
	}
	defer store.Pool.Close()
	if err = store.Migrate(startup); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}
	if err = store.SeedDefaults(startup); err != nil {
		return fmt.Errorf("seed default subscriptions: %w", err)
	}
	if err = store.ConfigureOwner(startup, config.password); err != nil {
		return fmt.Errorf("configure owner: %w", err)
	}
	cancelStartup()
	worker := app.NewWorker(store, fetcher)
	workerCtx, cancelWorker := context.WithCancel(ctx)
	defer cancelWorker()
	go worker.Run(workerCtx)
	api := &app.Server{Store: store, Fetcher: fetcher, Worker: worker, StaticDir: config.staticDir, TrustedProxies: config.trustedProxies}
	server := &http.Server{Addr: ":" + config.port, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10}
	serverErrors := make(chan error, 1)
	go func() { slog.Info("Margin listening", "port", config.port); serverErrors <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
	case err = <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			cancelWorker()
			<-worker.Done()
			return err
		}
	}
	cancelWorker()
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	shutdownErr := server.Shutdown(shutdown)
	if shutdownErr != nil {
		server.Close()
	}
	select {
	case <-worker.Done():
	case <-shutdown.Done():
		return shutdown.Err()
	}
	return shutdownErr
}

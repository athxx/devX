package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"devx/server/internal/app"
	"devx/server/internal/config"
)

func main() {
	cfg := config.Load()
	server, err := app.New(cfg)
	if err != nil {
		log.Fatalf("create app: %v", err)
	}

	go func() {
		log.Printf("DevX server listening on %s", cfg.Address())
		if err := server.Listen(cfg.Address()); err != nil {
			log.Fatalf("listen: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	<-ctx.Done()
	log.Println("shutting down DevX server")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.ShutdownWithContext(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}

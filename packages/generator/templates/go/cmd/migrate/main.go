package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"example.com/factory/application/internal/platform"
)

func run() error {
	ctx, stop := context.WithTimeout(context.Background(), 60*time.Second)
	defer stop()
	pool, err := platform.Connect(ctx)
	if err != nil || pool == nil {
		return fmt.Errorf("configure DATABASE_URL for the reviewed target")
	}
	defer pool.Close()
	count, err := platform.Apply(ctx, pool, "db/migrations")
	if err != nil {
		return fmt.Errorf("migration failed; review the target, SQL and applied history")
	}
	fmt.Printf("Applied migrations: %d\n", count)
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

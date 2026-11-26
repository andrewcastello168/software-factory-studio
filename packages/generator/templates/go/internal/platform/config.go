package platform

import (
	"context"
	"errors"
	"net"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Address() (string, error) {
	host, port := os.Getenv("HOST"), os.Getenv("PORT")
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "@@PORT@@"
	}
	value, err := strconv.Atoi(port)
	if err != nil || value < 1024 || value > 65535 {
		return "", errors.New("invalid PORT")
	}
	return net.JoinHostPort(host, port), nil
}

func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	source := os.Getenv("DATABASE_URL")
	if source == "" {
		return nil, nil
	}
	cfg, err := pgxpool.ParseConfig(source)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	cfg.ConnConfig.RuntimeParams["datestyle"] = "ISO, YMD"
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	cfg.MaxConns = 10
	return pgxpool.NewWithConfig(ctx, cfg)
}

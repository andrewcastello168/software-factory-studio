package platform

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var migrationName = regexp.MustCompile(`^[0-9]{4}_[a-z0-9_]+\.sql$`)

type migration struct{ name, sql, checksum string }

func migrations(directory string) ([]migration, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	var out []migration
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".sql") {
			continue
		}
		if !entry.Type().IsRegular() || !migrationName.MatchString(name) ||
			(len(out) > 0 && out[len(out)-1].name[:4] == name[:4]) {
			return nil, errors.New("invalid, duplicate or nonregular SQL migration")
		}
		data, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			return nil, err
		}
		out = append(out, migration{name, string(data), fmt.Sprintf("%x", sha256.Sum256(data))})
	}
	if len(out) == 0 {
		return nil, errors.New("no migrations found")
	}
	return out, nil
}

func Apply(ctx context.Context, pool *pgxpool.Pool, directory string) (int, error) {
	items, err := migrations(directory)
	if err != nil {
		return 0, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	for _, query := range []string{
		"SET LOCAL lock_timeout = '5s'",
		"SELECT pg_advisory_xact_lock(60543121)",
		"CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)",
	} {
		if _, err := tx.Exec(ctx, query); err != nil {
			return 0, err
		}
	}
	rows, err := tx.Query(ctx, `SELECT name, checksum FROM schema_migrations ORDER BY name COLLATE "C"`)
	if err != nil {
		return 0, err
	}
	applied := 0
	for rows.Next() {
		var name, checksum string
		if err := rows.Scan(&name, &checksum); err != nil {
			rows.Close()
			return 0, err
		}
		if applied >= len(items) || items[applied].name != name || items[applied].checksum != checksum {
			rows.Close()
			return 0, errors.New("applied migrations do not match the declared history")
		}
		applied++
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, item := range items[applied:] {
		if _, err := tx.Exec(ctx, item.sql, pgx.QueryExecModeSimpleProtocol); err != nil {
			return 0, fmt.Errorf("migration %s failed", item.name)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", item.name, item.checksum); err != nil {
			return 0, err
		}
	}
	return len(items) - applied, tx.Commit(ctx)
}

package records

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type repository struct {
	pool     *pgxpool.Pool
	relation string
	key      string
	project  string
	filter   string
}

func identifier(name string) string { return pgx.Identifier{name}.Sanitize() }

func newRepository(pool *pgxpool.Pool, t table) repository {
	var columns, search []string
	for _, f := range t.columns {
		name := identifier(f.name)
		column := "r." + name
		if f.kind == "date" {
			column = "pg_catalog.to_char(" + column + ", 'YYYY-MM-DD') AS " + name
		}
		columns = append(columns, column)
		search = append(search, "pg_catalog.strpos(pg_catalog.lower(r."+name+"::text), pg_catalog.lower($1)) > 0")
	}
	return repository{pool, identifier(t.name), "r." + identifier(t.key), strings.Join(columns, ", "), strings.Join(search, " OR ")}
}

func (r repository) projection() string {
	return "pg_catalog.row_to_json((SELECT item FROM (SELECT " + r.project + ") AS item))"
}

func param(index int, value argument) string {
	placeholder := fmt.Sprintf("$%d", index)
	switch value.field.kind {
	case "uuid":
		return placeholder + "::text::uuid"
	case "date":
		return placeholder + "::text::date"
	default:
		return placeholder
	}
}

func (r repository) list(ctx context.Context, options listOptions) (page, error) {
	rows, err := r.pool.Query(ctx, "SELECT "+r.projection()+" FROM "+r.relation+" AS r WHERE $1 = '' OR ("+r.filter+") ORDER BY "+r.key+" LIMIT $2 OFFSET $3",
		options.filter, options.limit+1, options.offset)
	if err != nil {
		return page{}, err
	}
	defer rows.Close()
	result := page{Rows: make([]json.RawMessage, 0)}
	for rows.Next() {
		var row json.RawMessage
		if err := rows.Scan(&row); err != nil {
			return page{}, err
		}
		result.Rows = append(result.Rows, row)
	}
	result.HasMore = len(result.Rows) > int(options.limit)
	if result.HasMore {
		result.Rows = result.Rows[:options.limit]
	}
	return result, rows.Err()
}

func (r repository) find(ctx context.Context, key argument) (json.RawMessage, error) {
	var result json.RawMessage
	err := r.pool.QueryRow(ctx, "SELECT "+r.projection()+" FROM "+r.relation+" AS r WHERE "+r.key+" = "+param(1, key), key.value).Scan(&result)
	return result, err
}

func (r repository) create(ctx context.Context, fields []argument) (json.RawMessage, error) {
	names, parameters := make([]string, 0, len(fields)), make([]string, 0, len(fields))
	args := make([]any, 0, len(fields))
	for index, field := range fields {
		names = append(names, identifier(field.field.name))
		parameters = append(parameters, param(index+1, field))
		args = append(args, field.value)
	}
	body := " DEFAULT VALUES"
	if len(fields) > 0 {
		body = " (" + strings.Join(names, ", ") + ") VALUES (" + strings.Join(parameters, ", ") + ")"
	}
	var result json.RawMessage
	err := r.pool.QueryRow(ctx, "INSERT INTO "+r.relation+" AS r"+body+" RETURNING "+r.projection(), args...).Scan(&result)
	return result, err
}

func (r repository) update(ctx context.Context, key argument, fields []argument) (json.RawMessage, error) {
	args := []any{key.value}
	columns := make([]string, 0, len(fields))
	for index, field := range fields {
		columns = append(columns, identifier(field.field.name)+" = "+param(index+2, field))
		args = append(args, field.value)
	}
	var result json.RawMessage
	err := r.pool.QueryRow(ctx, "UPDATE "+r.relation+" AS r SET "+strings.Join(columns, ", ")+" WHERE "+r.key+" = "+param(1, key)+" RETURNING "+r.projection(), args...).Scan(&result)
	return result, err
}

func (r repository) remove(ctx context.Context, key argument) (map[string]bool, error) {
	result, err := r.pool.Exec(ctx, "DELETE FROM "+r.relation+" AS r WHERE "+r.key+" = "+param(1, key), key.value)
	if err == nil && result.RowsAffected() == 0 {
		err = pgx.ErrNoRows
	}
	return map[string]bool{"deleted": err == nil}, err
}

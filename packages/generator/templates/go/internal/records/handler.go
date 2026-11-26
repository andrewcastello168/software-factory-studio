package records

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func issue(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func respond(c *gin.Context, status int, value any, err error) {
	var invalid inputError
	var pg *pgconn.PgError
	switch {
	case err == nil:
		c.JSON(status, gin.H{"data": value})
	case errors.As(err, &invalid):
		issue(c, 400, "invalid_request", invalid.Error())
	case errors.Is(err, pgx.ErrNoRows):
		issue(c, 404, "not_found", "Record not found.")
	case errors.As(err, &pg):
		switch pg.Code {
		case "23503", "23505", "23514", "23502":
			issue(c, 409, "constraint_violation", "The operation conflicts with a database constraint.")
		case "22P02", "22003", "22007", "22008":
			issue(c, 400, "invalid_request", "The database could not accept one of the supplied values.")
		default:
			issue(c, 503, "database_unavailable", "The record operation could not be completed.")
		}
	default:
		issue(c, 503, "database_unavailable", "The record operation could not be completed.")
	}
}

func decodeBody(c *gin.Context) (map[string]json.RawMessage, bool) {
	media, _, _ := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if media != "application/json" {
		issue(c, 415, "invalid_content_type", "Send an application/json request.")
		return nil, false
	}
	var values map[string]json.RawMessage
	decoder := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10))
	if err := decoder.Decode(&values); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			issue(c, 413, "invalid_body", "The request body is too large.")
		} else {
			issue(c, 400, "invalid_body", "The request body is invalid.")
		}
		return nil, false
	}
	if decoder.Decode(new(json.RawMessage)) != io.EOF {
		issue(c, 400, "invalid_body", "The request body must contain a single JSON object.")
		return nil, false
	}
	return values, true
}

func Register(api *gin.RouterGroup, pool *pgxpool.Pool) {
	for _, t := range tables {
		repo := newRepository(pool, t)
		route := api.Group("/crud/" + t.name)
		handle := func(status int, operation func(*gin.Context, context.Context) (any, error)) gin.HandlerFunc {
			return func(c *gin.Context) {
				if pool == nil {
					issue(c, 503, "database_unavailable", "PostgreSQL is unavailable.")
					return
				}
				ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
				defer cancel()
				value, err := operation(c, ctx)
				if !c.Writer.Written() {
					respond(c, status, value, err)
				}
			}
		}
		query := func(c *gin.Context) (url.Values, error) {
			values, err := url.ParseQuery(c.Request.URL.RawQuery)
			if err != nil {
				return nil, inputError("Provide valid query parameters.")
			}
			return values, nil
		}
		key := func(c *gin.Context) (argument, error) {
			values, err := query(c)
			if err != nil {
				return argument{}, err
			}
			return recordKey(t, values)
		}
		route.GET("", handle(200, func(c *gin.Context, ctx context.Context) (any, error) {
			values, err := query(c)
			if err != nil {
				return nil, err
			}
			options, err := listQuery(values)
			if err != nil {
				return nil, err
			}
			return repo.list(ctx, options)
		}))
		route.POST("", handle(201, func(c *gin.Context, ctx context.Context) (any, error) {
			raw, ok := decodeBody(c)
			if !ok {
				return nil, nil
			}
			fields, err := recordBody(t, raw, false)
			if err != nil {
				return nil, err
			}
			return repo.create(ctx, fields)
		}))
		route.GET("/record", handle(200, func(c *gin.Context, ctx context.Context) (any, error) {
			id, err := key(c)
			if err != nil {
				return nil, err
			}
			return repo.find(ctx, id)
		}))
		route.PATCH("/record", handle(200, func(c *gin.Context, ctx context.Context) (any, error) {
			id, err := key(c)
			if err != nil {
				return nil, err
			}
			raw, ok := decodeBody(c)
			if !ok {
				return nil, nil
			}
			fields, err := recordBody(t, raw, true)
			if err != nil {
				return nil, err
			}
			return repo.update(ctx, id, fields)
		}))
		route.DELETE("/record", handle(200, func(c *gin.Context, ctx context.Context) (any, error) {
			id, err := key(c)
			if err != nil {
				return nil, err
			}
			return repo.remove(ctx, id)
		}))
	}
}

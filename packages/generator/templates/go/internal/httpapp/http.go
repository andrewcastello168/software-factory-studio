package httpapp

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

@@CRUDIMPORT@@	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func New(pool *pgxpool.Pool, webRoot string, log *slog.Logger) *gin.Engine {
	app := gin.New()
	_ = app.SetTrustedProxies(nil)
	app.Use(func(c *gin.Context) {
		started := time.Now()
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; style-src 'self' 'unsafe-inline'")
		defer func() {
			if recover() != nil {
				log.Error("handler panic")
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "internal_error", "message": "The request could not be completed."}})
			}
			log.Info("http_request", "method", c.Request.Method, "status", c.Writer.Status(), "duration_ms", time.Since(started).Milliseconds())
		}()
		c.Next()
	})
	api := app.Group("/api")
	api.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "ok"}})
	})
	api.GET("/ready", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if pool == nil || pool.Ping(ctx) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "database_unavailable", "message": "PostgreSQL is unavailable."}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "ready"}})
	})
@@CRUDREGISTER@@	index := filepath.Join(webRoot, "index.html")
	if details, err := os.Stat(index); err == nil && details.Mode().IsRegular() {
		app.GET("/", func(c *gin.Context) { c.File(index) })
		app.Static("/assets", filepath.Join(webRoot, "assets"))
	}
	app.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "not_found", "message": "The API route was not found."}})
			return
		}
		c.Status(http.StatusNotFound)
	})
	return app
}

package httpapp

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
)

func TestLivenessAndReadiness(t *testing.T) {
	app := New(nil, t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	for path, want := range map[string]int{"/api/health": 200, "/api/ready": 503, "/api/welcome": 404, "/api/auth/session": 404} {
		result := httptest.NewRecorder()
		app.ServeHTTP(result, httptest.NewRequest("GET", path, nil))
		if result.Code != want || result.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: got %d, want %d", path, result.Code, want)
		}
	}
}

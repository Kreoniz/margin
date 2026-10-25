package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func healthServerPort(t *testing.T, server *httptest.Server) string {
	t.Helper()
	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	return port
}

func TestHealthcheckCLIBypassesStartupConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/health" {
			t.Errorf("unexpected health request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("PORT", healthServerPort(t, server))
	// These would fail configuration before any database connection or migration.
	t.Setenv("DATABASE_URL", "invalid-database-secret")
	t.Setenv("DATABASE_URL_FILE", "/missing-database-secret")
	t.Setenv("APP_PASSWORD", "short")
	t.Setenv("APP_PASSWORD_FILE", "/missing-password-secret")
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	if err := run([]string{"--healthcheck"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PORT", "invalid")
	if err := run([]string{"--healthcheck"}); err == nil || err.Error() != "PORT must be between 1 and 65535" {
		t.Fatalf("expected invalid port error, got %v", err)
	}
}

func TestHealthcheckRejectsUnhealthyResponses(t *testing.T) {
	for _, status := range []int{http.StatusNoContent, http.StatusFound, http.StatusUnauthorized, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("Location", "/redirected")
				w.WriteHeader(status)
				_, _ = w.Write([]byte("private-response-content"))
			}))
			defer server.Close()
			err := checkHealth(context.Background(), healthServerPort(t, server))
			if err == nil || err.Error() != "healthcheck returned an unhealthy status" {
				t.Fatalf("expected generic unhealthy status error, got %v", err)
			}
			if requests.Load() != 1 {
				t.Fatal("healthcheck followed a redirect")
			}
		})
	}
}

func TestHealthcheckConnectionFailure(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	port := healthServerPort(t, server)
	server.Close()
	if err := checkHealth(context.Background(), port); err == nil || err.Error() != "healthcheck request failed" {
		t.Fatalf("expected generic connection error, got %v", err)
	}
}

func TestHealthcheckTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	started := time.Now()
	if err := checkHealth(context.Background(), healthServerPort(t, server)); err == nil || err.Error() != "healthcheck request failed" {
		t.Fatalf("expected generic timeout error, got %v", err)
	}
	if time.Since(started) > healthcheckTimeout+2*time.Second {
		t.Fatal("healthcheck exceeded its timeout budget")
	}
}

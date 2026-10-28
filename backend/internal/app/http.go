package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Server struct {
	DevMode   bool
	Store     *Store
	Fetcher   *Fetcher
	Worker    *Worker
	StaticDir string
	// TrustedProxies contains exact proxy IP prefixes for the sign-in limiter.
	// Configure before serving requests; an empty list ignores forwarded headers.
	TrustedProxies []netip.Prefix
	limiter        loginLimiter
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	if s.DevMode {
		mux.HandleFunc("POST /api/dev/fixtures", s.devFixtures)
		mux.HandleFunc("DELETE /api/dev/fixtures", s.devFixtures)
	}
	mux.HandleFunc("GET /api/session", s.session)
	mux.HandleFunc("POST /api/setup", func(w http.ResponseWriter, r *http.Request) { s.signIn(w, r, true) })
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) { s.signIn(w, r, false) })
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/public/media", s.publicList)
	mux.HandleFunc("GET /api/public/media/{id}", s.publicItem)
	mux.HandleFunc("GET /api/integration/token", s.tokenStatus)
	mux.HandleFunc("POST /api/integration/token", s.rotateToken)
	mux.HandleFunc("DELETE /api/integration/token", s.revokeToken)
	mux.HandleFunc("POST /api/integrations/items", s.submitItem)
	mux.HandleFunc("GET /api/legacy-samples", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.Store.ListSamples(r.Context())
		respond(w, 200, items, err)
	})
	mux.HandleFunc("DELETE /api/legacy-samples", func(w http.ResponseWriter, r *http.Request) { respond(w, 204, nil, s.Store.DeleteSamples(r.Context())) })
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.Pool.Ping(r.Context()); err != nil {
			writeJSON(w, 503, map[string]string{"error": "Database is unavailable"})
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/bootstrap", s.bootstrap)
	mux.HandleFunc("GET /api/media", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.Store.ListMedia(r.Context())
		respond(w, 200, items, err)
	})
	mux.HandleFunc("POST /api/media", s.createMedia)
	mux.HandleFunc("PATCH /api/media/{id}", s.patchMedia)
	mux.HandleFunc("DELETE /api/media/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !requireID(w, r) {
			return
		}
		respond(w, 204, nil, s.Store.DeleteMedia(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("POST /api/metadata", s.metadata)
	mux.HandleFunc("POST /api/books/search", s.searchBooks)
	mux.HandleFunc("POST /api/images", s.uploadImage)
	mux.HandleFunc("GET /api/images/{id}", s.image)
	mux.HandleFunc("GET /api/export", s.exportLibrary)
	mux.HandleFunc("GET /api/integration/browser-token", s.browserTokenStatus)
	mux.HandleFunc("POST /api/integration/browser-token", s.rotateBrowserToken)
	mux.HandleFunc("DELETE /api/integration/browser-token", s.revokeBrowserToken)
	mux.HandleFunc("POST /api/integrations/capture", s.captureItem)
	mux.HandleFunc("PATCH /api/inbox/{id}", s.patchInbox)
	mux.HandleFunc("POST /api/inbox/{id}/save", func(w http.ResponseWriter, r *http.Request) {
		if !requireID(w, r) {
			return
		}
		m, created, err := s.Store.SaveInbox(r.Context(), r.PathValue("id"))
		status := 200
		if created {
			status = 201
		}
		respond(w, status, m, err)
	})
	mux.HandleFunc("GET /api/sources", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.Store.ListSources(r.Context())
		respond(w, 200, items, err)
	})
	mux.HandleFunc("POST /api/sources", s.createSource)
	mux.HandleFunc("PATCH /api/sources/{id}", s.patchSource)
	mux.HandleFunc("DELETE /api/sources/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !requireID(w, r) {
			return
		}
		respond(w, 204, nil, s.Store.DeleteSource(r.Context(), r.PathValue("id")))
	})
	mux.HandleFunc("POST /api/sync", func(w http.ResponseWriter, r *http.Request) {
		s.Worker.Trigger()
		writeJSON(w, 202, map[string]string{"message": "Sync started"})
	})
	mux.HandleFunc("/", s.static)
	return s.middleware(mux)
}

func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	// The inbox is bounded; the personal library and subscriptions are complete.
	media, err := s.Store.ListMedia(r.Context())
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	inbox, err := s.Store.ListInbox(r.Context(), true)
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	sources, err := s.Store.ListSources(r.Context())
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	count, err := s.Store.SampleCount(r.Context())
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	fixtureCount := 0
	if s.DevMode {
		fixtureCount, err = s.Store.devFixtureCount(r.Context())
		if err != nil {
			respond(w, 500, nil, err)
			return
		}
	}
	writeJSON(w, 200, struct {
		DevMode           bool        `json:"dev_mode"`
		DevFixtureCount   int         `json:"dev_fixture_count"`
		LegacySampleCount int         `json:"legacy_sample_count"`
		Media             []Media     `json:"media"`
		Inbox             []InboxItem `json:"inbox"`
		Sources           []Source    `json:"sources"`
	}{s.DevMode, fixtureCount, count, media, inbox, sources})
}
func (s *Server) createMedia(w http.ResponseWriter, r *http.Request) {
	var in MediaInput
	if !decode(w, r, &in) {
		return
	}
	m, err := s.prepareMedia(r.Context(), in)
	if err != nil {
		respond(w, 400, nil, &ValidationError{err.Error()})
		return
	}
	m, err = s.Store.CreateMedia(r.Context(), m)
	respond(w, 201, m, err)
}
func (s *Server) patchMedia(w http.ResponseWriter, r *http.Request) {
	if !requireID(w, r) {
		return
	}
	var in MediaInput
	if !decode(w, r, &in) {
		return
	}
	m, err := s.Store.PatchMedia(r.Context(), r.PathValue("id"), in)
	respond(w, 200, m, err)
}
func (s *Server) metadata(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL string `json:"url"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, err := s.Fetcher.Metadata(r.Context(), in.URL)
	respond(w, 200, m, err)
}
func (s *Server) patchInbox(w http.ResponseWriter, r *http.Request) {
	if !requireID(w, r) {
		return
	}
	var in struct {
		State string `json:"state"`
	}
	if !decode(w, r, &in) {
		return
	}
	i, err := s.Store.PatchInbox(r.Context(), r.PathValue("id"), in.State)
	respond(w, 200, i, err)
}
func (s *Server) createSource(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name            string `json:"name"`
		URL             string `json:"url"`
		IntervalMinutes *int   `json:"interval_minutes"`
		AutoSave        bool   `json:"auto_save"`
	}
	if !decode(w, r, &in) {
		return
	}
	interval := 60
	if in.IntervalMinutes != nil {
		interval = *in.IntervalMinutes
	}
	src, err := s.Fetcher.DiscoverSource(r.Context(), in.URL, strings.TrimSpace(in.Name), interval)
	if err != nil {
		respond(w, 201, nil, err)
		return
	}
	src.AutoSave = in.AutoSave
	src, err = s.Store.CreateSource(r.Context(), src)
	if err == nil {
		s.Worker.Trigger()
	}
	respond(w, 201, src, err)
}
func (s *Server) patchSource(w http.ResponseWriter, r *http.Request) {
	if !requireID(w, r) {
		return
	}
	var in SourcePatch
	if !decode(w, r, &in) {
		return
	}
	if in.Name != nil {
		v := strings.TrimSpace(*in.Name)
		in.Name = &v
	}
	src, err := s.Store.PatchSource(r.Context(), r.PathValue("id"), in)
	respond(w, 200, src, err)
}

func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if ct := r.Header.Get("Content-Type"); ct != "" {
		mediaType, _, err := mime.ParseMediaType(ct)
		if err != nil || mediaType != "application/json" {
			writeJSON(w, 415, map[string]string{"error": "Content-Type must be application/json"})
			return false
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			writeJSON(w, 413, map[string]string{"error": "Request body is too large"})
		} else {
			writeJSON(w, 400, map[string]string{"error": "Invalid JSON: " + clip(err.Error(), 200)})
		}
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeJSON(w, 400, map[string]string{"error": "Send one JSON object"})
		return false
	}
	return true
}
func requireID(w http.ResponseWriter, r *http.Request) bool {
	if !validID(r.PathValue("id")) {
		writeJSON(w, 400, map[string]string{"error": "Invalid UUID"})
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if status != 204 {
		if err := json.NewEncoder(w).Encode(value); err != nil {
			slog.Warn("write response", "error", err)
		}
	}
}
func respond(w http.ResponseWriter, status int, value any, err error) {
	if err == nil {
		writeJSON(w, status, value)
		return
	}
	var duplicate *DuplicateError
	var validation *ValidationError
	switch {
	case errors.As(err, &duplicate):
		writeJSON(w, 409, map[string]string{"error": err.Error(), "existing_id": duplicate.ExistingID})
	case errors.As(err, &validation):
		writeJSON(w, 400, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, 404, map[string]string{"error": "Not found"})
	case errors.Is(err, context.DeadlineExceeded):
		writeJSON(w, 504, map[string]string{"error": "Request timed out"})
	default:
		slog.Error("API request failed", "error", err)
		writeJSON(w, 500, map[string]string{"error": "Internal server error"})
	}
}

func sameOrigin(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		return false
	}
	raw := r.Header.Get("Origin")
	if raw == "" {
		raw = r.Header.Get("Referer")
	}
	if raw == "" {
		return true
	}
	u, err := url.Parse(raw)
	return err == nil && oneOf(u.Scheme, "http", "https") && u.User == nil && strings.EqualFold(u.Host, r.Host)
}
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("request panic", "panic", fmt.Sprint(recovered))
				writeJSON(w, 500, map[string]string{"error": "Internal server error"})
			}
		}()
		if !oneOf(r.Method, "GET", "HEAD", "OPTIONS") && r.URL.Path != "/api/integrations/capture" && !sameOrigin(r) {
			writeJSON(w, 403, map[string]string{"error": "Mutation requests must come from the same origin"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			ctx, cancel := context.WithTimeout(r.Context(), 35*time.Second)
			defer cancel()
			r = r.WithContext(ctx)
		}
		path := r.URL.Path
		publicPath := path == "/api/health" || path == "/api/session" || path == "/api/setup" || path == "/api/login" || path == "/api/logout" || path == "/api/integrations/items" || path == "/api/integrations/capture" || (strings.HasPrefix(path, "/api/images/") && oneOf(r.Method, "GET", "HEAD")) || strings.HasPrefix(path, "/api/public/")
		if strings.HasPrefix(path, "/api/public/") && !oneOf(r.Method, "GET", "HEAD") {
			writeJSON(w, 405, map[string]string{"error": "Public library is read-only"})
			return
		}
		if strings.HasPrefix(path, "/api/") && !publicPath {
			auth, err := s.authenticated(r)
			if err != nil {
				respond(w, 200, nil, err)
				return
			}
			if !auth {
				writeJSON(w, 401, map[string]string{"error": "Owner session required"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSON(w, 404, map[string]string{"error": "API route not found"})
		return
	}
	if !oneOf(r.Method, "GET", "HEAD") {
		writeJSON(w, 405, map[string]string{"error": "Method not allowed"})
		return
	}
	// os.Root confines file access including symlinks. SPA fallback only serves
	// index.html; missing assets never receive an HTML page with a 200 response.
	root, err := os.OpenRoot(s.StaticDir)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "Frontend is not built"})
		return
	}
	defer root.Close()
	rel := strings.TrimPrefix(filepath.Clean("/"+r.URL.Path), "/")
	if rel == "." || rel == "" {
		rel = "index.html"
	}
	if strings.HasPrefix(rel, ".") {
		http.NotFound(w, r)
		return
	}
	f, err := root.Open(rel)
	if err != nil && filepath.Ext(rel) == "" {
		rel = "index.html"
		f, err = root.Open(rel)
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, rel, info.ModTime(), f)
}

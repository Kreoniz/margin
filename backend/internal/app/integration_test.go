package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Every test creates a unique schema and drops ONLY that schema. It never
// truncates tables, drops a database, or migrates the caller's public schema.
func integrationStore(t *testing.T) *Store { return integrationStoreVersion(t, true) }
func integrationStoreVersion(t *testing.T, migrate bool) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a disposable database to run isolated-schema PostgreSQL tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "margin_test_" + strings.ReplaceAll(newID(), "-", "")
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer admin.Close()
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Errorf("remove isolated test schema: %v", err)
		}
	})
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	config.ConnConfig.RuntimeParams["timezone"] = "UTC"
	config.MaxConns = 12
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	s := &Store{pool}
	if !migrate {
		return s
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx); err != nil {
		t.Fatalf("idempotent migrations: %v", err)
	}
	return s
}

func TestIntegrationLibraryDuplicatesAndPatches(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	base := NewMedia()
	base.Title = "Concurrent book"
	base.Author = "Writer"
	base.Kind = "book"
	var successes atomic.Int32
	var duplicates atomic.Int32
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.CreateMedia(ctx, base)
			var duplicate *DuplicateError
			if err == nil {
				successes.Add(1)
			} else if errors.As(err, &duplicate) && validID(duplicate.ExistingID) {
				duplicates.Add(1)
			} else {
				t.Errorf("concurrent create: %v", err)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 || duplicates.Load() != 11 {
		t.Fatalf("creates=%d duplicates=%d", successes.Load(), duplicates.Load())
	}
	items, err := s.ListMedia(ctx)
	if err != nil || len(items) != 1 {
		t.Fatalf("library: %+v %v", items, err)
	}
	id := items[0].ID
	wg.Add(2)
	go func() {
		defer wg.Done()
		if _, err := s.PatchMedia(ctx, id, MediaInput{Visibility: ptr("public")}); err != nil {
			t.Error(err)
		}
	}()
	go func() {
		defer wg.Done()
		if _, err := s.PatchMedia(ctx, id, MediaInput{Notes: ptr("concurrent note")}); err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()
	items, err = s.ListMedia(ctx)
	if err != nil || items[0].Visibility != "public" || items[0].Notes != "concurrent note" {
		t.Fatalf("lost partial patch: %+v %v", items, err)
	}
	linked := base
	linked.Title = "A linked article"
	linked.URL = "https://example.com/post"
	first, err := s.CreateMedia(ctx, linked)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.PatchMedia(ctx, id, MediaInput{URL: ptr("http://www.example.com/post")})
	var duplicate *DuplicateError
	if !errors.As(err, &duplicate) || duplicate.ExistingID != first.ID {
		t.Fatalf("patch duplicate: %v", err)
	}
}

func TestIntegrationAtomicSaveAndDurableCollection(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	src, err := s.CreateSource(ctx, Source{Name: "Test publisher", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	claimed, token, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil || claimed.ID != src.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	if _, _, err = s.ClaimSource(ctx, false, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("overlapping lease accepted: %v", err)
	}
	entries := []InboxItem{{Title: "A collected article", URL: "https://example.com/article", PublishedAt: time.Now().UTC()}}
	if err = s.FinishSource(ctx, claimed, token, entries, nil); err != nil {
		t.Fatal(err)
	}
	inbox, err := s.ListInbox(ctx, true)
	if err != nil || len(inbox) != 1 {
		t.Fatalf("inbox: %+v %v", inbox, err)
	}
	media, err := s.ListMedia(ctx)
	if err != nil || len(media) != 0 {
		t.Fatal("collection implicitly changed the library")
	}
	if _, _, err = s.ClaimSource(ctx, false, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatal("source interval was not persisted")
	}
	id := inbox[0].ID
	var created atomic.Int32
	var wg sync.WaitGroup
	ids := make(chan string, 12)
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m, wasCreated, err := s.SaveInbox(ctx, id)
			if err != nil {
				t.Errorf("save: %v", err)
				return
			}
			if wasCreated {
				created.Add(1)
			}
			ids <- m.ID
		}()
	}
	wg.Wait()
	close(ids)
	if created.Load() != 1 {
		t.Fatalf("%d records created", created.Load())
	}
	savedID := ""
	for id := range ids {
		if savedID != "" && savedID != id {
			t.Fatal("idempotent save returned different IDs")
		}
		savedID = id
	}
	if _, err = s.PatchMedia(ctx, savedID, MediaInput{URL: ptr("https://example.com/edited-library-url")}); err != nil {
		t.Fatal(err)
	}
	again, wasCreated, err := s.SaveInbox(ctx, id)
	if err != nil || wasCreated || again.ID != savedID {
		t.Fatalf("save lost idempotence after library URL edit: %+v %v %v", again, wasCreated, err)
	}
	inbox, _ = s.ListInbox(ctx, true)
	if inbox[0].State != "saved" {
		t.Fatal("save did not mark inbox saved")
	}
	defaultInbox, _ := s.ListInbox(ctx, false)
	if len(defaultInbox) != 0 {
		t.Fatal("saved item in default inbox")
	}
	claimed, token, err = s.ClaimSource(ctx, true, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishSource(ctx, claimed, token, entries, nil); err != nil {
		t.Fatal(err)
	}
	inbox, _ = s.ListInbox(ctx, true)
	if len(inbox) != 1 || inbox[0].ID != id || inbox[0].State != "saved" {
		t.Fatal("resync duplicated a URL or reset user state")
	}
	claimed, token, err = s.ClaimSource(ctx, true, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishSource(ctx, claimed, token, nil, errors.New("upstream unavailable")); err != nil {
		t.Fatal(err)
	}
	sources, err := s.ListSources(ctx)
	if err != nil || sources[0].LastError != "upstream unavailable" || sources[0].LastSync == nil || sources[0].NextSync == nil || sources[0].ItemCount != 1 {
		t.Fatalf("sync status: %+v %v", sources, err)
	}
	if _, err = s.PatchSource(ctx, src.ID, SourcePatch{Enabled: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.ClaimSource(ctx, true, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatal("disabled source claimed")
	}
	if err = s.DeleteSource(ctx, src.ID); err != nil {
		t.Fatal(err)
	}
	media, _ = s.ListMedia(ctx)
	inbox, _ = s.ListInbox(ctx, true)
	if len(media) != 1 || len(inbox) != 0 {
		t.Fatal("deleting a source removed a saved library item or retained inbox")
	}
}

func TestIntegrationSeedsAndAPI(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	for range 2 {
		if err := s.SeedDefaults(ctx); err != nil {
			t.Fatal(err)
		}
	}
	sources, _ := s.ListSources(ctx)
	if len(sources) != 5 {
		t.Fatalf("default sources: %d", len(sources))
	}
	if err := s.DeleteSource(ctx, sources[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SeedDefaults(ctx); err != nil {
		t.Fatal(err)
	}
	sources, _ = s.ListSources(ctx)
	if len(sources) != 4 {
		t.Fatal("deleted default subscription was recreated")
	}
	f := NewFetcher()
	defer f.Close()
	srv := &Server{Store: s, Fetcher: f, Worker: NewWorker(s, f), StaticDir: t.TempDir()}
	if err := s.ConfigureOwner(ctx, "test-password-long"); err != nil {
		t.Fatal(err)
	}
	token, err := s.newOwnerSession(ctx, "test-password-long", false)
	if err != nil {
		t.Fatal(err)
	}
	handler := srv.Handler()
	request := func(method, path, body, origin string, auth bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "http://margin.example.com"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if auth {
			r.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/api/bootstrap", "", "", false); w.Code != 401 {
		t.Fatalf("auth status=%d", w.Code)
	}
	if w := request("POST", "/api/media", `{"title":"Attack"}`, "https://evil.example.com", true); w.Code != 403 {
		t.Fatalf("cross-origin mutation status=%d", w.Code)
	}
	w := request("GET", "/api/bootstrap", "", "", true)
	if w.Code != 200 {
		t.Fatalf("bootstrap: %d %s", w.Code, w.Body.String())
	}
	var boot struct {
		Media   []Media
		Inbox   []InboxItem
		Sources []Source
	}
	if err := json.Unmarshal(w.Body.Bytes(), &boot); err != nil || boot.Media == nil || boot.Inbox == nil || boot.Sources == nil {
		t.Fatalf("null list in bootstrap: %s %v", w.Body.String(), err)
	}
	w = request("POST", "/api/media", `{"title":"API book","kind":"book","tags":[]}`, "http://margin.example.com", true)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var item Media
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	w = request("POST", "/api/media", `{"title":" api BOOK ","kind":"book"}`, "", true)
	if w.Code != 409 || !strings.Contains(w.Body.String(), item.ID) {
		t.Fatalf("duplicate: %d %s", w.Code, w.Body.String())
	}
	w = request("PATCH", "/api/media/"+item.ID, `{"status":"done"}`, "", true)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"done"`) {
		t.Fatalf("completion: %d %s", w.Code, w.Body.String())
	}
	w = request("PATCH", "/api/media/"+item.ID, `{"surprise":true}`, "", true)
	if w.Code != 400 {
		t.Fatal("unknown field accepted")
	}
	w = request("DELETE", "/api/media/"+item.ID, "", "", true)
	if w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	w = request("POST", "/api/sync", "", "", true)
	if w.Code != 202 {
		t.Fatal("sync was not accepted asynchronously")
	}
	media, err := s.ListMedia(ctx)
	if err != nil || len(media) != 0 {
		t.Fatalf("unexpected fabricated library: %+v %v", media, err)
	}
}

func TestIntegrationWorkerIsolatesFailures(t *testing.T) {
	s := integrationStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, name := range []string{"good", "broken", "disabled"} {
		src, err := s.CreateSource(ctx, Source{Name: name, SiteURL: "https://example.com/", FeedURL: "https://example.com/" + name, Parser: "rss", IntervalMinutes: 60})
		if err != nil {
			t.Fatal(err)
		}
		if name == "disabled" {
			if _, err = s.PatchSource(ctx, src.ID, SourcePatch{Enabled: ptr(false)}); err != nil {
				t.Fatal(err)
			}
		}
	}
	f := NewFetcher()
	defer f.Close()
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(started)
			select {
			case <-release:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
		}
		if r.URL.Path == "/disabled" {
			t.Error("worker fetched a disabled source")
		}
		if r.URL.Path == "/broken" {
			return fakeResponse(r, 503, "text/html", "unavailable"), nil
		}
		return fakeResponse(r, 200, "application/rss+xml", `<rss version="2.0"><channel><title>Good</title><item><title>Collected</title><link>https://example.com/collected</link></item></channel></rss>`), nil
	})
	w := NewWorker(s, f)
	go w.Run(ctx)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not start")
	}
	close(release)
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		sources, err := s.ListSources(ctx)
		if err != nil {
			t.Fatal(err)
		}
		finished := 0
		for _, src := range sources {
			if src.LastSync != nil {
				finished++
			}
			if src.Name == "broken" && src.LastSync != nil && src.LastError == "" {
				t.Fatal("source error was hidden")
			}
		}
		if finished == 2 && !w.busy.Load() {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("worker did not finish independent sources")
		case <-ticker.C:
		}
	}
	cancel()
	select {
	case <-w.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not shut down")
	}
	if calls.Load() != 2 {
		t.Fatalf("scheduled pass made %d fetches", calls.Load())
	}
	inbox, err := s.ListInbox(context.Background(), true)
	if err != nil || len(inbox) != 1 {
		t.Fatalf("healthy source failed to collect: %+v %v", inbox, err)
	}
}

func TestIntegrationExpiredLeaseRecovery(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	src, err := s.CreateSource(ctx, Source{Name: "Lease", SiteURL: "https://example.com/", FeedURL: "https://example.com/lease", Parser: "rss", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	_, oldToken, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE sources SET lease_until=now()-interval '1 second' WHERE id=$1", src.ID); err != nil {
		t.Fatal(err)
	}
	claimed, token, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil || token == oldToken {
		t.Fatalf("crashed lease was not recovered: %v", err)
	}
	if err = s.FinishSource(ctx, claimed, oldToken, nil, errors.New("stale worker")); err != nil {
		t.Fatal(err)
	}
	if err = s.FinishSource(ctx, claimed, token, nil, nil); err != nil {
		t.Fatal(err)
	}
	sources, err := s.ListSources(ctx)
	if err != nil || sources[0].LastError != "" || sources[0].LastSync == nil {
		t.Fatalf("stale worker overwrote the new lease: %+v %v", sources, err)
	}
}

func TestHTTPOriginAndSPASafety(t *testing.T) {
	for _, tc := range []struct {
		origin  string
		allowed bool
	}{{"http://margin.example.com", true}, {"https://margin.example.com", true}, {"https://evil.example.com", false}, {"null", false}, {"http://margin.example.com:1234", false}} {
		r := httptest.NewRequest("POST", "http://margin.example.com/api/media", nil)
		r.Header.Set("Origin", tc.origin)
		if sameOrigin(r) != tc.allowed {
			t.Errorf("origin %q", tc.origin)
		}
	}
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/index.html", []byte("SPA"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/etc/passwd", dir+"/secret.txt"); err != nil {
		t.Fatal(err)
	}
	s := &Server{StaticDir: dir}
	handler := s.Handler()
	for _, tc := range []struct {
		path string
		code int
	}{{"/library", 200}, {"/missing.js", 404}, {"/secret.txt", 404}, {"/api/missing", 401}} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://margin.example.com"+tc.path, nil))
		if w.Code != tc.code {
			t.Errorf("%s: %d", tc.path, w.Code)
		}
	}
}

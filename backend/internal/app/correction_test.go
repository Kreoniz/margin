package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func oldStore(t *testing.T) *Store {
	t.Helper()
	s := integrationStoreVersion(t, false)
	ctx := context.Background()
	body, err := migrations.ReadFile("migrations/001_initial.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(name) VALUES('migrations/001_initial.sql')`); err != nil {
		t.Fatal(err)
	}
	return s
}

type legacySeed struct {
	Title, Author, Kind, Status, URL, CoverURL, Description, Notes, Unit string
	Tags                                                                 []string
	Favorite                                                             bool
	Progress, Total                                                      float64
	Rating, Ordinal                                                      int
}

func historicalSeeds(t *testing.T) []legacySeed {
	t.Helper()
	body, err := os.ReadFile("testdata/legacy_seed_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var out []legacySeed
	if err = json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func insertHistorical(t *testing.T, s *Store, seeds []legacySeed, marker bool) []string {
	t.Helper()
	ctx := context.Background()
	ids := []string{}
	stamp := time.Date(2026, 10, 10, 12, 23, 34, 123456000, time.UTC)
	for _, m := range seeds {
		id := newID()
		ids = append(ids, id)
		u, mk := mediaKeys(Media{Title: m.Title, Author: m.Author, Kind: m.Kind, URL: m.URL})
		created := stamp.AddDate(0, 0, -m.Ordinal)
		var completed *time.Time
		if m.Status == "completed" {
			completed = &created
		}
		_, err := s.Pool.Exec(ctx, `INSERT INTO media(id,title,author,kind,status,url,url_key,manual_key,cover_url,description,notes,tags,favorite,progress,total,unit,rating,created_at,updated_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, id, m.Title, m.Author, m.Kind, m.Status, m.URL, u, mk, m.CoverURL, m.Description, m.Notes, m.Tags, m.Favorite, m.Progress, m.Total, m.Unit, m.Rating, created, stamp, completed)
		if err != nil {
			t.Fatal(err)
		}
	}
	if marker {
		if _, err := s.Pool.Exec(ctx, "INSERT INTO app_settings VALUES('demo_library_v1','seeded')"); err != nil {
			t.Fatal(err)
		}
	}
	return ids
}
func TestCorrectionFreshAndUpgradeMigrations(t *testing.T) {
	ctx := context.Background()
	t.Run("legacy normalized sample URL", func(t *testing.T) {
		s := oldStore(t)
		seeds := historicalSeeds(t)
		// The original URL normalizer removed non-root trailing slashes before
		// persistence, even though the seed's literal URL included one.
		seeds[8].URL = strings.TrimSuffix(seeds[8].URL, "/")
		insertHistorical(t, s, seeds, true)
		if err := s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		samples, err := s.ListSamples(ctx)
		if err != nil || len(samples) != 12 {
			t.Fatalf("normalized samples=%d %v", len(samples), err)
		}
		items, err := s.ListMedia(ctx)
		if err != nil || len(items) != 0 {
			t.Fatalf("normalized sample leaked into real library: %+v %v", items, err)
		}
	})
	t.Run("fresh", func(t *testing.T) {
		s := integrationStore(t)
		items, err := s.ListMedia(ctx)
		if err != nil || len(items) != 0 {
			t.Fatalf("fresh library %+v %v", items, err)
		}
		var count int
		err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='media' AND column_name IN ('progress','total','unit','favorite','rating')`).Scan(&count)
		if err != nil || count != 0 {
			t.Fatalf("obsolete schema columns=%d %v", count, err)
		}
	})
	t.Run("upgrade", func(t *testing.T) {
		s := oldStore(t)
		seeds := historicalSeeds(t)
		ids := insertHistorical(t, s, seeds, true)
		// A real user record retains its identity, notes, URL, tags and completion date.
		real := newID()
		completed := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
		_, err := s.Pool.Exec(ctx, `INSERT INTO media(id,title,kind,status,url,url_key,notes,tags,completed_at) VALUES($1,'Real test record','book','completed','https://example.com/real',$2,'private original note',ARRAY['personal'],$3)`, real, urlKey("https://example.com/real"), completed)
		if err != nil {
			t.Fatal(err)
		}
		if err = s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		if err = s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		samples, err := s.ListSamples(ctx)
		if err != nil || len(samples) != 12 {
			t.Fatalf("samples=%d %v", len(samples), err)
		}
		gotIDs := map[string]bool{}
		for _, m := range samples {
			gotIDs[m.ID] = true
			if m.Visibility != "private" {
				t.Fatal(m)
			}
		}
		for _, id := range ids {
			if !gotIDs[id] {
				t.Fatal("sample ID lost")
			}
		}
		items, err := s.ListMedia(ctx)
		if err != nil || len(items) != 1 {
			t.Fatalf("real items %+v %v", items, err)
		}
		m := items[0]
		if m.ID != real || m.Notes != "private original note" || m.URL != "https://example.com/real" || m.Status != "done" || m.CompletedAt == nil || !m.CompletedAt.Equal(completed) || len(m.Tags) != 1 || m.Tags[0] != "personal" {
			t.Fatalf("changed personal data %+v", m)
		}
		if _, err = s.Pool.Exec(ctx, "UPDATE media SET visibility='public' WHERE is_demo"); err != nil {
			t.Fatal(err)
		}
		public, err := s.listMediaWhere(ctx, "visibility='public' AND NOT is_demo")
		if err != nil || len(public) != 0 {
			t.Fatal("samples exposed publicly")
		}
		if err = s.DeleteSamples(ctx); err != nil {
			t.Fatal(err)
		}
		if err = s.DeleteSamples(ctx); err != nil {
			t.Fatal(err)
		}
		items, err = s.ListMedia(ctx)
		if err != nil || len(items) != 1 || items[0].ID != real {
			t.Fatal("cleanup removed real data")
		}
	})
}
func TestCorrectionSampleIdentificationRequiresEveryOriginalField(t *testing.T) {
	changes := map[string]string{
		"title": "title=title||' edited'", "author": "author='My author'", "kind": "kind='article'", "status": "status='later'",
		"url": "url='https://example.com/my-copy',url_key='my-copy',manual_key=NULL", "cover": "cover_url='https://example.com/cover.png'",
		"description": "description=description||' edited'", "notes": "notes='My notes'", "tags": "tags=ARRAY['mine']",
		"progress": "progress=155", "total": "total=433", "unit": "unit='chapters'", "favorite": "favorite=false", "rating": "rating=1",
		"created": "created_at=created_at+interval '1 second'", "updated": "updated_at=updated_at+interval '1 second'", "completed": "completed_at=now()",
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			s := oldStore(t)
			ids := insertHistorical(t, s, historicalSeeds(t)[:1], true)
			if _, err := s.Pool.Exec(context.Background(), "UPDATE media SET "+change+" WHERE id=$1", ids[0]); err != nil {
				t.Fatal(err)
			}
			if err := s.Migrate(context.Background()); err != nil {
				t.Fatal(err)
			}
			n, err := s.SampleCount(context.Background())
			if err != nil || n != 0 {
				t.Fatalf("edited record quarantined: %d %v", n, err)
			}
			if err = s.DeleteSamples(context.Background()); err != nil {
				t.Fatal(err)
			}
			items, err := s.ListMedia(context.Background())
			if err != nil || len(items) != 1 || items[0].ID != ids[0] {
				t.Fatal("edited record removed")
			}
		})
	}
	t.Run("no marker", func(t *testing.T) {
		s := oldStore(t)
		insertHistorical(t, s, historicalSeeds(t), false)
		if err := s.Migrate(context.Background()); err != nil {
			t.Fatal(err)
		}
		n, err := s.SampleCount(context.Background())
		if err != nil || n != 0 {
			t.Fatal("unmarked records quarantined")
		}
	})
	t.Run("new copy", func(t *testing.T) {
		s := oldStore(t)
		ids := insertHistorical(t, s, historicalSeeds(t)[:1], true)
		if _, err := s.Pool.Exec(context.Background(), "UPDATE media SET created_at=updated_at WHERE id=$1", ids[0]); err != nil {
			t.Fatal(err)
		}
		if err := s.Migrate(context.Background()); err != nil {
			t.Fatal(err)
		}
		n, _ := s.SampleCount(context.Background())
		if n != 0 {
			t.Fatal("new copy quarantined")
		}
	})
}

type apiTestClient struct {
	t       *testing.T
	handler http.Handler
	cookie  *http.Cookie
	bearer  string
}

func (c *apiTestClient) request(method, path, body string) *httptest.ResponseRecorder {
	c.t.Helper()
	r := httptest.NewRequest(method, "https://margin.example.com"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	if c.bearer != "" {
		r.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	return w
}
func requireCode(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("HTTP %d want %d: %s", w.Code, want, w.Body.String())
	}
}
func responseMap(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func ownerClient(t *testing.T, s *Store) (*apiTestClient, *Fetcher) {
	t.Helper()
	f := NewFetcher()
	t.Cleanup(f.Close)
	srv := &Server{Store: s, Fetcher: f, Worker: NewWorker(s, f), StaticDir: t.TempDir()}
	c := &apiTestClient{t: t, handler: srv.Handler()}
	w := c.request("POST", "/api/setup", `{"password":"owner-test-password"}`)
	requireCode(t, w, 201)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("no session cookie")
	}
	c.cookie = cookies[0]
	return c, f
}
func TestCorrectionAuthenticationAndPublicPrivacy(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	c, f := ownerClient(t, s)
	if !c.cookie.HttpOnly || !c.cookie.Secure || c.cookie.SameSite != http.SameSiteLaxMode || c.cookie.MaxAge <= 0 {
		t.Fatalf("unsafe cookie %+v", c.cookie)
	}
	anon := &apiTestClient{t: t, handler: c.handler}
	w := anon.request("GET", "/api/session", "")
	requireCode(t, w, 200)
	if w.Body.String() != "{\"authenticated\":false,\"setup_required\":false}\n" {
		t.Fatal(w.Body.String())
	}
	for _, path := range []string{"/api/bootstrap", "/api/media", "/api/sources", "/api/legacy-samples", "/api/integration/token"} {
		requireCode(t, anon.request("GET", path, ""), 401)
	}
	requireCode(t, anon.request("GET", "/api/health", ""), 200)
	var stored string
	if err := s.Pool.QueryRow(ctx, "SELECT password_hash FROM owner_credentials").Scan(&stored); err != nil || strings.Contains(stored, "owner-test-password") || !passwordMatches(stored, "owner-test-password") {
		t.Fatal("password not securely hashed")
	}
	if err := s.Pool.QueryRow(ctx, "SELECT token_hash FROM owner_sessions").Scan(&stored); err != nil || stored == c.cookie.Value || stored != hash(c.cookie.Value) {
		t.Fatal("session not hashed")
	}
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Extracted title</title><meta name="author" content="Extracted author"><meta name="description" content="Extracted description">`), nil
	})
	w = c.request("POST", "/api/media", `{"url":"https://example.com/private","notes":"secret private note"}`)
	requireCode(t, w, 201)
	privateID := responseMap(t, w)["id"].(string)
	if responseMap(t, w)["title"] != "Extracted title" {
		t.Fatal("URL-only metadata missing")
	}
	requireCode(t, anon.request("GET", "/api/public/media/"+privateID, ""), 404)
	w = c.request("POST", "/api/media", `{"title":"Public test record","notes":"secret public note","visibility":"public","status":"done"}`)
	requireCode(t, w, 201)
	publicID := responseMap(t, w)["id"].(string)
	w = anon.request("GET", "/api/public/media", "")
	requireCode(t, w, 200)
	if strings.Contains(w.Body.String(), "secret") || strings.Contains(w.Body.String(), privateID) || strings.Contains(w.Body.String(), "notes") || strings.Contains(w.Body.String(), "inbox") || strings.Contains(w.Body.String(), "source") || !strings.Contains(w.Body.String(), publicID) {
		t.Fatal("public privacy failure: " + w.Body.String())
	}
	w = anon.request("GET", "/api/public/media/"+publicID, "")
	requireCode(t, w, 200)
	if _, ok := responseMap(t, w)["notes"]; ok {
		t.Fatal("notes exposed")
	}
	for _, field := range []string{"progress", "total", "unit", "favorite", "rating"} {
		if strings.Contains(w.Body.String(), `"`+field+`"`) {
			t.Fatalf("obsolete %s", field)
		}
		requireCode(t, c.request("PATCH", "/api/media/"+publicID, `{"`+field+`":0}`), 400)
	}
	for _, method := range []string{"POST", "PATCH", "DELETE"} {
		requireCode(t, c.request(method, "/api/public/media/"+publicID, `{}`), 405)
	}
	// Basic credentials and cross-site requests do not confer editing authority.
	r := httptest.NewRequest("POST", "https://margin.example.com/api/media", strings.NewReader(`{"title":"Attack"}`))
	r.AddCookie(c.cookie)
	r.Header.Set("Origin", "https://evil.example.com")
	w = httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	requireCode(t, w, 403)
	r = httptest.NewRequest("GET", "https://margin.example.com/api/media", nil)
	r.SetBasicAuth("margin", "owner-test-password")
	w = httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	requireCode(t, w, 401)
	requireCode(t, c.request("POST", "/api/logout", ""), 204)
	requireCode(t, c.request("GET", "/api/media", ""), 401)
	requireCode(t, anon.request("POST", "/api/login", `{"password":"wrong-long-password"}`), 401)
	w = anon.request("POST", "/api/login", `{"password":"owner-test-password"}`)
	requireCode(t, w, 200)
	c.cookie = w.Result().Cookies()[0]
	if _, err := s.Pool.Exec(ctx, "UPDATE owner_sessions SET expires_at=now()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	requireCode(t, c.request("GET", "/api/media", ""), 401)
	requireCode(t, anon.request("POST", "/api/setup", `{"password":"another-password-long"}`), 409)
}
func TestCorrectionAtomicSetupAndEnvironmentPassword(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	var successes, conflicts atomic.Int32
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			_, err := s.newOwnerSession(ctx, "setup-password-long", true)
			if err == nil {
				successes.Add(1)
			} else if errors.Is(err, errConfigured) {
				conflicts.Add(1)
			} else {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if successes.Load() != 1 || conflicts.Load() != 3 {
		t.Fatalf("setup successes=%d conflicts=%d", successes.Load(), conflicts.Load())
	}
	if err := s.ConfigureOwner(ctx, "short"); err == nil {
		t.Fatal("short environment password accepted")
	}
	token, err := s.newOwnerSession(ctx, "setup-password-long", false)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ConfigureOwner(ctx, "setup-password-long"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM owner_sessions WHERE token_hash=$1", hash(token)).Scan(&n); err != nil || n != 1 {
		t.Fatal("unchanged env password revoked session")
	}
	if err = s.ConfigureOwner(ctx, "changed-password-long"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.newOwnerSession(ctx, "setup-password-long", false); !errors.Is(err, errCredentials) {
		t.Fatal("old env password valid")
	}
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM owner_sessions").Scan(&n); err != nil || n != 0 {
		t.Fatal("password change retained sessions")
	}
}
func TestCorrectionBoundedLoginLimiter(t *testing.T) {
	var limiter loginLimiter
	now := time.Now()
	for i := 0; i < 10; i++ {
		if !limiter.allow("192.0.2.1:123", now) {
			t.Fatal("early limit")
		}
	}
	if limiter.allow("192.0.2.1:456", now) {
		t.Fatal("port bypassed limit")
	}
	if !limiter.allow("192.0.2.1:456", now.Add(time.Minute)) {
		t.Fatal("limit never expires")
	}
	for i := 0; i < 5000; i++ {
		limiter.allow(fmt.Sprintf("192.0.%d.%d:1", i/256, i%256), now.Add(time.Duration(i)*time.Second))
	}
	if len(limiter.clients) > 1024 {
		t.Fatal("limiter memory unbounded")
	}
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	for range 10 {
		c.request("POST", "/api/login", `{"password":"wrong-password-long"}`)
	}
	requireCode(t, c.request("POST", "/api/login", `{"password":"owner-test-password"}`), 429)
}

func TestCorrectionSubmissionTokenPermissionsAndIdempotency(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	owner, f := ownerClient(t, s)
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Metadata title</title><meta name="author" content="Metadata author"><meta name="description" content="Metadata description">`), nil
	})
	w := owner.request("GET", "/api/integration/token", "")
	requireCode(t, w, 200)
	if responseMap(t, w)["configured"] != false || responseMap(t, w)["created_at"] != nil {
		t.Fatal(w.Body.String())
	}
	w = owner.request("POST", "/api/integration/token", "")
	requireCode(t, w, 200)
	token := responseMap(t, w)["token"].(string)
	var stored string
	if err := s.Pool.QueryRow(ctx, "SELECT token_hash FROM integration_token").Scan(&stored); err != nil || stored != hash(token) || stored == token {
		t.Fatal("integration token not hashed")
	}
	w = owner.request("GET", "/api/integration/token", "")
	requireCode(t, w, 200)
	if strings.Contains(w.Body.String(), token) || strings.Contains(w.Body.String(), "token\"") {
		t.Fatal("stored token disclosed")
	}
	submitter := &apiTestClient{t: t, handler: owner.handler, bearer: token}
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/media", ""}, {"GET", "/api/bootstrap", ""}, {"GET", "/api/integration/token", ""}, {"POST", "/api/integration/token", ""}, {"DELETE", "/api/integration/token", ""}, {"GET", "/api/legacy-samples", ""}, {"DELETE", "/api/legacy-samples", ""}, {"POST", "/api/sources", `{}`}, {"POST", "/api/metadata", `{"url":"https://example.com/private"}`}, {"POST", "/api/media", `{"title":"unauthorized"}`}, {"PATCH", "/api/media/" + newID(), `{"visibility":"public"}`}, {"DELETE", "/api/media/" + newID(), ""}, {"POST", "/api/sync", ""},
	} {
		requireCode(t, submitter.request(tc.method, tc.path, tc.body), 401)
	}
	requireCode(t, owner.request("POST", "/api/integrations/items", `{"title":"Cookie-only submission"}`), 401)
	for _, body := range []string{`{"title":"Override","status":"done"}`, `{"title":"Override","visibility":"public"}`, `{"title":"Override","progress":10}`, `{}`, `{"url":"http://127.0.0.1/private"}`} {
		requireCode(t, submitter.request("POST", "/api/integrations/items", body), 400)
	}
	w = submitter.request("POST", "/api/integrations/items", `{"url":"https://example.com/submission","title":"Explicit title","author":"Explicit author","kind":"paper","tags":["test"],"notes":"private token note"}`)
	requireCode(t, w, 201)
	receipt := responseMap(t, w)
	if len(receipt) != 2 || receipt["created"] != true {
		t.Fatalf("bad minimal receipt %s", w.Body.String())
	}
	id := receipt["id"].(string)
	items, err := s.ListMedia(ctx)
	if err != nil || len(items) != 1 {
		t.Fatal(items, err)
	}
	m := items[0]
	if m.Visibility != "private" || m.Status != "pending" || m.Notes != "private token note" || m.Author != "Explicit author" || m.Kind != "paper" || m.Description != "Metadata description" || len(m.Tags) != 1 {
		t.Fatalf("metadata merge %+v", m)
	}
	// Duplicate submission must neither disclose nor change private owner edits.
	// The edited URL retains its canonical key while its literal value is private.
	changed, err := s.PatchMedia(ctx, id, MediaInput{Title: ptr("Owner's private edited title"), URL: ptr("https://example.com/submission#private-owner-fragment"), Status: ptr("done"), Notes: ptr("owner's private note")})
	if err != nil {
		t.Fatal(err)
	}
	w = submitter.request("POST", "/api/integrations/items", `{"url":"http://www.example.com/submission?utm_source=test","title":"Overwrite attempt","notes":"different"}`)
	requireCode(t, w, 200)
	receipt = responseMap(t, w)
	if len(receipt) != 2 || receipt["created"] != false || receipt["id"] != id {
		t.Fatalf("duplicate leaked metadata or was not idempotent: %s", w.Body.String())
	}
	items, err = s.ListMedia(ctx)
	if err != nil || len(items) != 1 || items[0].Visibility != "private" || items[0].Title != changed.Title || items[0].URL != changed.URL || items[0].Notes != changed.Notes || items[0].Status != "done" || !items[0].CompletedAt.Equal(*changed.CompletedAt) {
		t.Fatal("duplicate overwrote existing")
	}
	// Concurrent title-only submissions all receive the same durable identity.
	var wg sync.WaitGroup
	var made atomic.Int32
	ids := make(chan string, 8)
	for range 8 {
		wg.Go(func() {
			result := submitter.request("POST", "/api/integrations/items", `{"title":"Concurrent integration test"}`)
			if result.Code != 200 && result.Code != 201 {
				t.Errorf("submit %d %s", result.Code, result.Body.String())
				return
			}
			var receipt map[string]any
			if err := json.Unmarshal(result.Body.Bytes(), &receipt); err != nil {
				t.Error(err)
				return
			}
			id, ok := receipt["id"].(string)
			if !ok || !validID(id) || len(receipt) != 2 || receipt["created"] != (result.Code == 201) {
				t.Errorf("bad concurrent receipt: %s", result.Body.String())
				return
			}
			if receipt["created"] == true {
				made.Add(1)
			}
			ids <- id
		})
	}
	wg.Wait()
	close(ids)
	same := ""
	for id := range ids {
		if same != "" && id != same {
			t.Fatal("different duplicate IDs")
		}
		same = id
	}
	if made.Load() != 1 {
		t.Fatalf("created=%d", made.Load())
	}
	requireCode(t, submitter.request("POST", "/api/integrations/items", `{"title":"`+strings.Repeat("x", 300000)+`"}`), 413)
	w = owner.request("POST", "/api/integration/token", "")
	requireCode(t, w, 200)
	next := responseMap(t, w)["token"].(string)
	if next == token {
		t.Fatal("rotation reused token")
	}
	requireCode(t, submitter.request("POST", "/api/integrations/items", `{"title":"Revoked"}`), 401)
	submitter.bearer = next
	requireCode(t, submitter.request("POST", "/api/integrations/items", `{"title":"New-token test record"}`), 201)
	requireCode(t, owner.request("DELETE", "/api/integration/token", ""), 204)
	requireCode(t, submitter.request("POST", "/api/integrations/items", `{"title":"Revoked again"}`), 401)
	requireCode(t, owner.request("GET", "/api/media", ""), 200)
}

func TestCorrectionAutoSaveCutoffsAndSeenRecords(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	src, err := s.CreateSource(ctx, Source{Name: "Auto-save test publisher", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	if src.AutoSave {
		t.Fatal("auto-save default true")
	}
	collect := func(entries []InboxItem) {
		t.Helper()
		claimed, token, err := s.ClaimSource(ctx, true, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if err = s.FinishSource(ctx, claimed, token, entries, nil); err != nil {
			t.Fatal(err)
		}
	}
	entry := func(name string, published time.Time) InboxItem {
		return InboxItem{Title: "Test " + name, URL: "https://example.com/" + name, PublishedAt: published}
	}
	// Discover first, then enable: already-seen new/read/dismissed entries never save.
	future := time.Now().Add(time.Hour).UTC()
	seen := []InboxItem{entry("seen-new", future), entry("seen-read", future), entry("seen-dismissed", future)}
	collect(seen)
	inbox, err := s.ListInbox(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range inbox {
		if strings.HasSuffix(i.URL, "read") {
			if _, err = s.PatchInbox(ctx, i.ID, "read"); err != nil {
				t.Fatal(err)
			}
		}
		if strings.HasSuffix(i.URL, "dismissed") {
			if _, err = s.PatchInbox(ctx, i.ID, "dismissed"); err != nil {
				t.Fatal(err)
			}
		}
	}
	src, err = s.PatchSource(ctx, src.ID, SourcePatch{AutoSave: ptr(true)})
	if err != nil || !src.AutoSave {
		t.Fatal(src, err)
	}
	var cutoff time.Time
	if err = s.Pool.QueryRow(ctx, "SELECT auto_save_after FROM sources WHERE id=$1", src.ID).Scan(&cutoff); err != nil {
		t.Fatal(err)
	}
	// Repeating true preserves cutoff; disabling/re-enabling advances it.
	if _, err = s.PatchSource(ctx, src.ID, SourcePatch{AutoSave: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	var same time.Time
	if err = s.Pool.QueryRow(ctx, "SELECT auto_save_after FROM sources WHERE id=$1", src.ID).Scan(&same); err != nil || !same.Equal(cutoff) {
		t.Fatal("true patch moved cutoff")
	}
	existing := NewMedia()
	existing.Title = "Owner's existing metadata"
	existing.URL = "https://example.com/existing"
	existing.Notes = "keep private note"
	existing.Visibility = "public"
	existing.Status = "done"
	stamp := time.Now().Add(-time.Hour)
	existing.CompletedAt = &stamp
	existing, err = s.CreateMedia(ctx, existing)
	if err != nil {
		t.Fatal(err)
	}
	removed := NewMedia()
	removed.Title = "Deleted manual test record"
	removed.URL = "https://example.com/deleted-manual"
	removed, err = s.CreateMedia(ctx, removed)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteMedia(ctx, removed.ID); err != nil {
		t.Fatal(err)
	}
	unknown := entry("undated", future)
	unknown.PublishedUnknown = true
	batch := append(seen, entry("historical", cutoff.Add(-time.Microsecond)), entry("new-future", future), entry("at-cutoff", cutoff), entry("existing", future), entry("deleted-manual", future), unknown)
	collect(batch)
	items, err := s.ListMedia(ctx)
	if err != nil || len(items) != 3 {
		t.Fatalf("auto-save items=%+v %v", items, err)
	}
	var autoID string
	for _, m := range items {
		if m.ID == existing.ID {
			if m.Title != existing.Title || m.Notes != existing.Notes || m.Visibility != "public" || m.Status != "done" || !m.CompletedAt.Equal(*existing.CompletedAt) || !m.UpdatedAt.Equal(existing.UpdatedAt) {
				t.Fatal("existing metadata altered")
			}
		} else {
			if m.Visibility != "private" || m.Status != "pending" {
				t.Fatal("auto-save not private pending")
			}
			if m.URL == "https://example.com/new-future" {
				autoID = m.ID
			}
		}
	}
	if autoID == "" {
		t.Fatal("future article not saved")
	}
	if err = s.DeleteMedia(ctx, autoID); err != nil {
		t.Fatal(err)
	}
	collect(batch)
	items, err = s.ListMedia(ctx)
	if err != nil || len(items) != 2 {
		t.Fatal("deleted auto-save recreated")
	}
	inbox, err = s.ListInbox(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]string{}
	for _, i := range inbox {
		states[i.URL] = i.State
	}
	if states["https://example.com/seen-new"] != "new" || states["https://example.com/seen-read"] != "read" || states["https://example.com/seen-dismissed"] != "dismissed" || states["https://example.com/new-future"] != "read" {
		t.Fatal("seen states changed", states)
	}
	// Deleted source/inbox rows do not erase the persistent seen keys.
	if err = s.DeleteSource(ctx, src.ID); err != nil {
		t.Fatal(err)
	}
	src, err = s.CreateSource(ctx, Source{Name: "Recreated test source", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60, AutoSave: true})
	if err != nil {
		t.Fatal(err)
	}
	collect([]InboxItem{entry("new-future", future)})
	items, err = s.ListMedia(ctx)
	if err != nil || len(items) != 2 {
		t.Fatal("source recreation resaved seen URL")
	}
	if _, err = s.PatchSource(ctx, src.ID, SourcePatch{AutoSave: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	disabledAt := time.Now().UTC()
	collect([]InboxItem{entry("while-disabled", future)})
	if _, err = s.PatchSource(ctx, src.ID, SourcePatch{AutoSave: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if err = s.Pool.QueryRow(ctx, "SELECT auto_save_after FROM sources WHERE id=$1", src.ID).Scan(&same); err != nil || !same.After(disabledAt) {
		t.Fatal("re-enable did not reset cutoff")
	}
	collect([]InboxItem{entry("while-disabled", future), entry("before-new-cutoff", disabledAt), entry("after-new-cutoff", future)})
	items, err = s.ListMedia(ctx)
	if err != nil || len(items) != 3 {
		t.Fatalf("re-enable backfilled %+v %v", items, err)
	}
}

func TestCorrectionUndatedFeedNeverAutoSaves(t *testing.T) {
	now := time.Now()
	items, err := ParseFeed([]byte(`<rss version="2.0"><channel><title>Test</title><item><title>Undated</title><link>https://example.com/undated</link></item></channel></rss>`), "https://example.com/feed", now)
	if err != nil || len(items) != 1 || !items[0].PublishedUnknown || !items[0].PublishedAt.Equal(now) {
		t.Fatal("undated provenance lost", items, err)
	}
}

func TestCorrectionFirstRunAndConfiguredStartup(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	f := NewFetcher()
	defer f.Close()
	srv := &Server{Store: s, Fetcher: f, Worker: NewWorker(s, f)}
	c := &apiTestClient{t: t, handler: srv.Handler()}
	w := c.request("GET", "/api/session", "")
	requireCode(t, w, 200)
	state := responseMap(t, w)
	if state["authenticated"] != false || state["setup_required"] != true {
		t.Fatal(w.Body.String())
	}
	for _, password := range []string{"short", "пароль"} {
		if err := s.ConfigureOwner(ctx, password); err == nil {
			t.Fatal("short password accepted")
		}
	}
	if err := s.ConfigureOwner(ctx, "configured-password-long"); err != nil {
		t.Fatal(err)
	}
	requireCode(t, c.request("POST", "/api/setup", `{"password":"different-password-long"}`), 409)
	w = c.request("POST", "/api/login", `{"password":"configured-password-long"}`)
	requireCode(t, w, 200)
	c.cookie = w.Result().Cookies()[0]
	requireCode(t, c.request("GET", "/api/bootstrap", ""), 200)
}
func TestCorrectionRevocationWhileFetchingMetadata(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	w := owner.request("POST", "/api/integration/token", "")
	requireCode(t, w, 200)
	token := responseMap(t, w)["token"].(string)
	submitter := &apiTestClient{t: t, handler: owner.handler, bearer: token}
	started := make(chan struct{})
	release := make(chan struct{})
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return fakeResponse(r, 200, "text/html", "<title>Revocation test</title>"), nil
	})
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		result <- submitter.request("POST", "/api/integrations/items", `{"url":"https://example.com/revoked-during-fetch"}`)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("metadata did not start")
	}
	requireCode(t, owner.request("DELETE", "/api/integration/token", ""), 204)
	close(release)
	select {
	case w = <-result:
		requireCode(t, w, 401)
	case <-time.After(5 * time.Second):
		t.Fatal("submission did not finish")
	}
	items, err := s.ListMedia(context.Background())
	if err != nil || len(items) != 0 {
		t.Fatal("revoked in-flight request created media", items, err)
	}
}

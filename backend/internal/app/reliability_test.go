package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPausingDiscardsAnInflightSourceResult(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	source, err := s.CreateSource(ctx, Source{Name: "Paused fetch", SiteURL: "https://example.com", FeedURL: "https://example.com/feed", Parser: "rss", Enabled: true, AutoSave: true, IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	claimed, token, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil || claimed.ID != source.ID {
		t.Fatal(claimed, err)
	}
	if _, err = s.PatchSource(ctx, source.ID, SourcePatch{Enabled: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if err = s.FinishSource(ctx, claimed, token, []InboxItem{{Title: "In flight", URL: "https://example.com/new", PublishedAt: time.Now().Add(time.Hour)}}, nil); err != nil {
		t.Fatal(err)
	}
	var inbox, media int
	if err = s.Pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM inbox),(SELECT count(*) FROM media)").Scan(&inbox, &media); err != nil || inbox != 0 || media != 0 {
		t.Fatal(inbox, media, err)
	}
	if _, err = s.PatchSource(ctx, source.ID, SourcePatch{Enabled: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if _, next, e := s.ClaimSource(ctx, false, time.Now()); e != nil || next == token {
		t.Fatal("resume did not get a fresh lease", e)
	}
}

func TestBrowserYouTubePlaceholdersRemainPendingAndEnrich(t *testing.T) {
	for _, complete := range []bool{false, true} {
		t.Run(fmt.Sprint(complete), func(t *testing.T) {
			s := integrationStore(t)
			c, f := ownerClient(t, s)
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return fakeResponse(r, 200, "application/json", `{"title":"Actual video","author_name":"Actual creator","thumbnail_url":"https://i.ytimg.com/vi/NBCM_ZoWZo8/hqdefault.jpg","type":"video"}`), nil
			})
			token := responseMap(t, c.request("POST", "/api/integration/browser-token", ""))["token"].(string)
			hint := map[string]string{"title": "YouTube"}
			if complete {
				hint["author"] = "Consent author"
				hint["cover_url"] = "https://example.com/consent.jpg"
				hint["description"] = "Consent details"
			}
			body, _ := json.Marshal(map[string]any{"url": "https://www.youtube.com/watch?v=NBCM_ZoWZo8", "action": "save", "page_metadata": hint})
			r := httptest.NewRequest("POST", "/api/integrations/capture", bytes.NewReader(body))
			r.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			c.handler.ServeHTTP(w, r)
			requireCode(t, w, 201)
			if responseMap(t, w)["metadata_state"] != "pending" {
				t.Fatal(w.Body.String())
			}
			NewWorker(s, f).enrichPending(context.Background())
			items, err := s.ListMedia(context.Background())
			if err != nil || len(items) != 1 || items[0].Title != "Actual video" || items[0].Author != "Actual creator" || items[0].MetadataState != "ready" {
				t.Fatal(items, err)
			}
		})
	}
}

type brokenExportWriter struct{ *httptest.ResponseRecorder }

func (brokenExportWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestExportLogsFinalStreamFailureWithoutPrivateContent(t *testing.T) {
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	requireCode(t, c.request("POST", "/api/media", `{"title":"Private title","notes":"Private note must not appear in logs"}`), 201)
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previous)
	w := brokenExportWriter{httptest.NewRecorder()}
	(&Server{Store: s}).exportLibrary(w, httptest.NewRequest("GET", "/api/export", nil))
	if !strings.Contains(logs.String(), "library export failed") || !strings.Contains(logs.String(), "zip_close") || strings.Contains(logs.String(), "Private note") {
		t.Fatal(logs.String())
	}
	if _, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len())); err == nil {
		t.Fatal("failed stream unexpectedly produced a valid archive")
	}
}

func TestTitlelessHTMLIsPartialAndRetryRecovers(t *testing.T) {
	for _, manual := range []string{"", "My deliberate title"} {
		t.Run(manual, func(t *testing.T) {
			s := integrationStore(t)
			c, f := ownerClient(t, s)
			phase := "missing"
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				body := `<html><head></head><body><div id="app"></div></body></html>`
				if phase == "good" {
					body = `<title>Recovered title</title>`
				}
				if phase == "slug" {
					body = `<title>story 123</title>`
				}
				return fakeResponse(r, 200, "text/html", body), nil
			})
			values := map[string]any{"url": "https://publisher.example/story-123", "fetch_metadata": true}
			if manual != "" {
				values["title"] = manual
			}
			body, _ := json.Marshal(values)
			w := c.request("POST", "/api/media", string(body))
			requireCode(t, w, 201)
			id := responseMap(t, w)["id"].(string)
			NewWorker(s, f).enrichPending(context.Background())
			items, err := s.ListMedia(context.Background())
			want := manual
			if want == "" {
				want = "story 123"
			}
			if err != nil || len(items) != 1 || items[0].Title != want || items[0].MetadataState != "partial" || !strings.Contains(items[0].MetadataWarning, "title") {
				t.Fatal(items, err)
			}
			phase = "good"
			if _, err = s.PatchMedia(context.Background(), id, MediaInput{FetchMetadata: true}); err != nil {
				t.Fatal(err)
			}
			NewWorker(s, f).enrichPending(context.Background())
			items, err = s.ListMedia(context.Background())
			if manual == "" {
				want = "Recovered title"
			}
			if err != nil || items[0].Title != want || items[0].MetadataState != "ready" || items[0].MetadataWarning != "" {
				t.Fatal(items, err)
			}
			phase = "slug"
			metadata, err := f.Metadata(context.Background(), values["url"].(string))
			if err != nil || metadata.Title != "story 123" || metadata.Warning != "" {
				t.Fatal("real title matching the slug was misclassified", metadata, err)
			}
		})
	}
}

func TestCaptureDeletionBetweenReadsDoesNotResurrect(t *testing.T) {
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	url := "https://example.com/deletion-" + newID()
	body, _ := json.Marshal(map[string]string{"title": "Saved page", "url": url, "author": "Writer", "description": "Summary", "kind": "article"})
	created := c.request("POST", "/api/media", string(body))
	requireCode(t, created, 201)
	id := responseMap(t, created)["id"].(string)
	token := responseMap(t, c.request("POST", "/api/integration/browser-token", ""))["token"].(string)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	gate, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Rollback(context.Background())
	if _, err = gate.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", urlKey(url)); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		payload, _ := json.Marshal(map[string]string{"url": url, "action": "done"})
		r := httptest.NewRequest("POST", "/api/integrations/capture", bytes.NewReader(payload)).WithContext(ctx)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		c.handler.ServeHTTP(w, r)
		done <- w
	}()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND ((classid::bigint << 32) | objid::bigint)=hashtextextended($1,0))`, urlKey(url)).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("capture never reached the controlled lock", ctx.Err())
		case <-ticker.C:
		}
	}
	requireCode(t, c.request("DELETE", "/api/media/"+id, ""), 204)
	if err = gate.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case w := <-done:
		requireCode(t, w, 409)
		if !strings.Contains(w.Body.String(), "removed while capturing") {
			t.Fatal(w.Body.String())
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	items, err := s.ListMedia(context.Background())
	if err != nil || len(items) != 0 {
		t.Fatal("capture resurrected the deleted record", items, err)
	}
}

func TestSparseEditorPreservesPrivacyAndRejectsOverlappingEdits(t *testing.T) {
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	created := c.request("POST", "/api/media", `{"title":"Original","visibility":"public","notes":"Old note"}`)
	requireCode(t, created, 201)
	var original Media
	if err := json.Unmarshal(created.Body.Bytes(), &original); err != nil {
		t.Fatal(err)
	}
	requireCode(t, c.request("PATCH", "/api/media/"+original.ID, `{"visibility":"private","status":"done","notes":"New note"}`), 200)
	payload, _ := json.Marshal(MediaInput{Title: ptr("Title edit"), Expected: &original})
	w := c.request("PATCH", "/api/media/"+original.ID, string(payload))
	requireCode(t, w, 200)
	var after Media
	_ = json.Unmarshal(w.Body.Bytes(), &after)
	if after.Visibility != "private" || after.Status != "done" || after.Notes != "New note" {
		t.Fatalf("unrelated values lost: %+v", after)
	}
	anon := httptest.NewRecorder()
	c.handler.ServeHTTP(anon, httptest.NewRequest("GET", "/api/public/media/"+original.ID, nil))
	requireCode(t, anon, 404)
	w = c.request("PATCH", "/api/media/"+original.ID, string(payload))
	requireCode(t, w, 409)
	if responseMap(t, w)["code"] != "edit_conflict" {
		t.Fatal(w.Body.String())
	}
	_, err := s.PatchMedia(context.Background(), original.ID, MediaInput{Notes: ptr("Stale note"), Expected: &original})
	if !errors.Is(err, ErrEditConflict) {
		t.Fatalf("same-field overwrite allowed: %v", err)
	}
}

func TestInboxFilteringBeforeLimitAndStableContinuation(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	src, err := s.CreateSource(ctx, Source{Name: "Quiet source", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO inbox(id,source_id,title,url,url_key,published_at,discovered_at,state)
 SELECT gen_random_uuid(),$1,'Dismissed '||n,'https://example.com/'||n,'dismissed-'||n,now(),now(),'dismissed' FROM generate_series(1,1000) n`, src.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO inbox(id,source_id,title,url,url_key,published_at,discovered_at)
 VALUES($1,$2,'Old unread 100%','https://example.com/old','old',now()-interval '1 day',now()-interval '1 day')`, newID(), src.ID)
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.PageInbox(ctx, "new", src.ID, "old 100%", "")
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].Title != "Old unread 100%" {
		t.Fatalf("old unread hidden: %+v %v", page, err)
	}
	seen := map[string]bool{}
	cursor := ""
	for {
		page, err = s.PageInbox(ctx, "dismissed", src.ID, "", cursor)
		if err != nil || page.Total != 1000 || len(page.Items) > 40 {
			t.Fatalf("page %+v %v", page, err)
		}
		for _, i := range page.Items {
			if seen[i.ID] {
				t.Fatal("duplicate cursor row", i.ID)
			}
			seen[i.ID] = true
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(seen) != 1000 {
		t.Fatalf("lost rows: %d", len(seen))
	}
	counts, err := s.InboxCounts(ctx)
	if err != nil || counts["new"] != 1 || counts["dismissed"] != 1000 {
		t.Fatalf("counts %+v %v", counts, err)
	}
	if _, err = s.PageInbox(ctx, "new", "", "", "invalid"); err == nil {
		t.Fatal("bad cursor accepted")
	}
}

func TestDeferredMetadataKeepsExplicitDefaultKinds(t *testing.T) {
	for _, kind := range []string{"article", "other"} {
		t.Run(kind, func(t *testing.T) {
			s := integrationStore(t)
			c, f := ownerClient(t, s)
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return fakeResponse(r, 200, "text/html", `<title>Video title</title><meta property="og:type" content="video">`), nil
			})
			w := c.request("POST", "/api/media", fmt.Sprintf(`{"url":"https://example.com/video","kind":%q,"fetch_metadata":true}`, kind))
			requireCode(t, w, 201)
			NewWorker(s, f).enrichPending(context.Background())
			items, err := s.ListMedia(context.Background())
			if err != nil || items[0].Kind != kind || !items[0].KindExplicit || items[0].MetadataState != "ready" {
				t.Fatalf("explicit kind changed: %+v %v", items, err)
			}
		})
	}
	s := integrationStore(t)
	c, f := ownerClient(t, s)
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Automatic video</title><meta property="og:type" content="video">`), nil
	})
	requireCode(t, c.request("POST", "/api/media", `{"url":"https://example.com/video","kind":"article","infer_kind":true,"fetch_metadata":true}`), 201)
	NewWorker(s, f).enrichPending(context.Background())
	items, _ := s.ListMedia(context.Background())
	if items[0].Kind != "video" {
		t.Fatal("automatic inference disabled", items[0])
	}
}

func TestUnresolvedISBNIsReviewableAndRecoverable(t *testing.T) {
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	w := c.request("POST", "/api/media", `{"title":"9780132350884","kind":"book"}`)
	requireCode(t, w, 201)
	item := responseMap(t, w)
	if item["needs_review"] != true || item["metadata_state"] != "partial" || !strings.Contains(item["metadata_warning"].(string), "Correct book match") {
		t.Fatal(w.Body.String())
	}
	id := item["id"].(string)
	w = c.request("PATCH", "/api/media/"+id, `{"title":"The resolved book","author":"Writer","needs_review":false}`)
	requireCode(t, w, 200)
	if responseMap(t, w)["needs_review"] != false || responseMap(t, w)["metadata_warning"] != nil {
		t.Fatal("book did not recover", w.Body.String())
	}
	w = c.request("POST", "/api/media", `{"title":"An intentional title-only book","kind":"book"}`)
	requireCode(t, w, 201)
	if responseMap(t, w)["needs_review"] != false {
		t.Fatal("ordinary book incorrectly flagged")
	}
}

func TestUploadAttachmentCoordinatesWithOrphanCleanup(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	insertImage := func() string {
		t.Helper()
		id := newID()
		_, err := s.Pool.Exec(ctx, "INSERT INTO images(id,body,created_at) VALUES($1,$2,now()-interval '2 days')", id, []byte("fixture"))
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	expired := insertImage()
	if err := s.cleanupImages(ctx); err != nil {
		t.Fatal(err)
	}
	m := NewMedia()
	m.Title = "Expired draft"
	m.CoverURL = "/api/images/" + expired
	_, err := s.CreateMedia(ctx, m)
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("missing upload accepted: %v", err)
	}
	attached := insertImage()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	m.Title = "Attaching draft"
	m.CoverURL = "/api/images/" + attached
	if _, _, err = insertMedia(ctx, tx, m); err != nil {
		t.Fatal(err)
	}
	// Attachment's FK lock is still uncommitted. Cleanup must skip that image.
	if err = s.cleanupImages(ctx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.cleanupImages(ctx); err != nil {
		t.Fatal(err)
	}
	var exists bool
	if err = s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM images WHERE id=$1)", attached).Scan(&exists); err != nil || !exists {
		t.Fatal("attached image removed", err)
	}
}

func TestAutomaticAdditionsAndDeletionRemainDistinctFromManualSave(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	_, err := s.CreateSource(ctx, Source{Name: "Automatic", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60, AutoSave: true})
	if err != nil {
		t.Fatal(err)
	}
	src, token, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	entries := []InboxItem{{Title: "Automatic", URL: "https://example.com/auto", PublishedAt: time.Now().Add(time.Hour)}, {Title: "Manual", URL: "https://example.com/manual", PublishedAt: time.Now().Add(-time.Hour)}}
	if err = s.FinishSource(ctx, src, token, entries, nil); err != nil {
		t.Fatal(err)
	}
	items, _ := s.ListMedia(ctx)
	if len(items) != 1 || !items[0].AutoAdded {
		t.Fatal("automatic provenance missing", items)
	}
	autoID := items[0].ID
	inbox, _ := s.PageInbox(ctx, "new", src.ID, "", "")
	manual, _, err := s.SaveInbox(ctx, inbox.Items[0].ID)
	if err != nil || manual.AutoAdded {
		t.Fatal("manual save labeled automatic", err)
	}
	if err = s.DeleteMedia(ctx, autoID); err != nil {
		t.Fatal(err)
	}
	src, token, err = s.ClaimSource(ctx, true, time.Now().Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishSource(ctx, src, token, entries, nil); err != nil {
		t.Fatal(err)
	}
	items, _ = s.ListMedia(ctx)
	if len(items) != 1 || items[0].ID != manual.ID {
		t.Fatal("removed auto item came back", items)
	}
}

func TestSourcePersistenceFailureIsRecordedAfterRollback(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	_, err := s.CreateSource(ctx, Source{Name: "Fails storage", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Pool.Exec(ctx, `CREATE FUNCTION reject_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected storage failure'; END $$;
 CREATE TRIGGER reject_inbox BEFORE INSERT ON inbox FOR EACH ROW EXECUTE FUNCTION reject_inbox()`)
	if err != nil {
		t.Fatal(err)
	}
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "application/rss+xml", `<rss version="2.0"><channel><title>Feed</title><item><title>Article</title><link>https://example.com/article</link></item></channel></rss>`), nil
	})
	NewWorker(s, f).sync(ctx, true)
	sources, err := s.ListSources(ctx)
	if err != nil || len(sources) != 1 || !strings.Contains(sources[0].LastError, "Could not store") || sources[0].LastSync == nil {
		t.Fatalf("failure status absent: %+v %v", sources, err)
	}
}

func TestYouTubeMetadataUsesFirstPartyEndpointAndKeepsFallbackHonest(t *testing.T) {
	for _, input := range []string{"https://www.youtube.com/watch?v=NBCM_ZoWZo8&feature=youtu.be", "https://youtu.be/NBCM_ZoWZo8", "https://www.youtube.com/shorts/NBCM_ZoWZo8", "https://www.youtube.com/embed/NBCM_ZoWZo8"} {
		t.Run(input, func(t *testing.T) {
			f := NewFetcher()
			defer f.Close()
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "www.youtube.com" || r.URL.Path != "/oembed" || r.URL.Query().Get("url") != "https://www.youtube.com/watch?v=NBCM_ZoWZo8" {
					t.Fatalf("unexpected request %s", r.URL)
				}
				return fakeResponse(r, 200, "application/json", `{"title":"Video title","author_name":"Channel","type":"video","thumbnail_url":"https://i.ytimg.com/vi/NBCM_ZoWZo8/hqdefault.jpg"}`), nil
			})
			m, err := f.Metadata(context.Background(), input)
			if err != nil || m.Title != "Video title" || m.Author != "Channel" || m.Kind != "video" || m.CoverURL == "" || m.Warning != "" {
				t.Fatalf("video %+v %v", m, err)
			}
		})
	}
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/oembed" {
			return fakeResponse(r, 401, "text/plain", "Unavailable"), nil
		}
		return fakeResponse(r, 200, "text/html", `<title>Before you continue to YouTube</title>`), nil
	})
	m, err := f.Metadata(context.Background(), "https://youtu.be/NBCM_ZoWZo8")
	if err != nil || m.Kind != "video" || m.Warning == "" || strings.Contains(m.Title, "continue") {
		t.Fatalf("consent page looked complete: %+v %v", m, err)
	}
}

func TestFragmentNavigationAndRouteIdentity(t *testing.T) {
	page, err := CanonicalURL("https://example.com/paper.pdf#page=12")
	if err != nil || page != "https://example.com/paper.pdf#page=12" {
		t.Fatal(page, err)
	}
	if urlKey(page) != urlKey("https://example.com/paper.pdf") {
		t.Fatal("ordinary anchors no longer share document identity")
	}
	if urlKey("https://example.com/#/article/a") == urlKey("https://example.com/#/article/b") {
		t.Fatal("hash routes conflated")
	}
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Fragment != "" {
			t.Fatal("fragment sent to fetcher")
		}
		return fakeResponse(r, 200, "application/pdf", "%PDF-"), nil
	})
	if _, err = f.Get(context.Background(), page, 100); err != nil {
		t.Fatal(err)
	}
}

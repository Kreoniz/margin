package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func sampleStore(t *testing.T) (*Store, []Media) {
	t.Helper()
	s := oldStore(t)
	insertHistorical(t, s, historicalSeeds(t), true)
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	samples, err := s.ListSamples(context.Background())
	if err != nil || len(samples) != 12 {
		t.Fatalf("quarantined samples: %+v %v", samples, err)
	}
	return s, samples
}

func sampleSnapshot(t *testing.T, s *Store) string {
	t.Helper()
	var snapshot string
	if err := s.Pool.QueryRow(context.Background(), "SELECT jsonb_agg((to_jsonb(m) - 'needs_review' - 'metadata_state' - 'metadata_warning' - 'metadata_lease_token' - 'metadata_lease_until') ORDER BY id)::text FROM media m WHERE is_demo").Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestSampleKeyMigrationFrom002PreservesRowsAndSeenHistory(t *testing.T) {
	ctx := context.Background()
	s := oldStore(t)
	insertHistorical(t, s, historicalSeeds(t), true)
	// Reproduce a database already on 002, with its original global UNIQUE keys.
	body, err := migrations.ReadFile("migrations/002_product_correction.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES('migrations/002_product_correction.sql')"); err != nil {
		t.Fatal(err)
	}
	var oldKeys int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM pg_constraint WHERE conrelid='media'::regclass AND conname IN ('media_url_key_key','media_manual_key_key')").Scan(&oldKeys); err != nil || oldKeys != 2 {
		t.Fatalf("002 constraints: %d %v", oldKeys, err)
	}
	// A key without surviving media/inbox is deliberately ambiguous history.
	if _, err = s.Pool.Exec(ctx, "INSERT INTO seen_articles(url_key,first_seen_at) VALUES($1,'2020-01-02T03:04:05Z')", urlKey("https://example.com/deleted-history")); err != nil {
		t.Fatal(err)
	}
	seenSnapshot := func() string {
		t.Helper()
		var snapshot string
		if err := s.Pool.QueryRow(ctx, "SELECT jsonb_agg(to_jsonb(s) ORDER BY url_key)::text FROM seen_articles s").Scan(&snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	beforeSamples, beforeSeen := sampleSnapshot(t, s), seenSnapshot()
	for range 2 {
		if err = s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if sampleSnapshot(t, s) != beforeSamples || seenSnapshot() != beforeSeen {
		t.Fatal("003 changed sample data or historical seen keys")
	}
	migrationFiles, err := migrations.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	var applied int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&applied); err != nil || applied != len(migrationFiles) {
		t.Fatalf("migration ledger: %d %v", applied, err)
	}
	// Exercise both repaired indexes on the upgraded database.
	for _, seed := range historicalSeeds(t)[6:8] {
		m := NewMedia()
		m.Title, m.Author, m.Kind, m.URL = seed.Title, seed.Author, seed.Kind, seed.URL
		if _, err = s.CreateMedia(ctx, m); err != nil {
			t.Fatalf("real copy after 002 -> 003: %v", err)
		}
	}
}

func TestSampleIdentificationPreservesExplicitInboxSaves(t *testing.T) {
	for _, state := range []string{"saved", "new", "read", "dismissed"} {
		t.Run(state, func(t *testing.T) {
			ctx := context.Background()
			s := oldStore(t)
			seeds := historicalSeeds(t)
			ids := insertHistorical(t, s, seeds, true)
			sourceID := newID()
			if _, err := s.Pool.Exec(ctx, `INSERT INTO sources(id,name,site_url,feed_url,source_key,parser) VALUES($1,'Legacy inbox','https://example.com','https://example.com/feed','legacy','rss')`, sourceID); err != nil {
				t.Fatal(err)
			}
			// Links, rather than inbox URL/state, prove intent. The manual sample
			// has no URL, and the linked paper's inbox URL has since changed.
			for _, index := range []int{6, 7} {
				u := "https://example.com/saved/" + ids[index]
				if _, err := s.Pool.Exec(ctx, `INSERT INTO inbox(id,source_id,title,url,url_key,published_at,state,media_id) VALUES($1,$2,'Saved by owner',$3,$4,now(),$5,$6)`, newID(), sourceID, u, urlKey(u), state, ids[index]); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.Migrate(ctx); err != nil {
				t.Fatal(err)
			}
			items, err := s.ListMedia(ctx)
			if err != nil || len(items) != 2 {
				t.Fatalf("explicit saves quarantined: %+v %v", items, err)
			}
			for _, m := range items {
				index := 6
				if m.ID == ids[7] {
					index = 7
				}
				if m.ID != ids[index] || m.Notes != seeds[index].Notes || m.Status != "done" || m.CompletedAt == nil || !m.CompletedAt.Equal(m.CreatedAt) {
					t.Fatalf("saved personal data changed: %+v", m)
				}
			}
			if count, err := s.SampleCount(ctx); err != nil || count != 10 {
				t.Fatalf("unlinked samples misidentified: %d %v", count, err)
			}
			if err = s.DeleteSamples(ctx); err != nil {
				t.Fatal(err)
			}
			inbox, err := s.ListInbox(ctx, true)
			if err != nil || len(inbox) != 2 {
				t.Fatalf("saved inbox lost: %+v %v", inbox, err)
			}
			for _, item := range inbox {
				var linked string
				if err = s.Pool.QueryRow(ctx, "SELECT media_id::text FROM inbox WHERE id=$1", item.ID).Scan(&linked); err != nil || (linked != ids[6] && linked != ids[7]) || item.State != state {
					t.Fatalf("explicit save relationship changed: %+v %s %v", item, linked, err)
				}
			}
		})
	}
}

func TestSampleCopiesCreateAndPatchWithoutInheritingData(t *testing.T) {
	for _, index := range []int{6, 7} { // completed manual movie and URL paper
		seed := historicalSeeds(t)[index]
		for _, operation := range []string{"create", "patch"} {
			t.Run(seed.Title+"/"+operation, func(t *testing.T) {
				s, _ := sampleStore(t)
				before := sampleSnapshot(t, s)
				owner, f := ownerClient(t, s)
				f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
					return fakeResponse(r, 200, "text/html", "<title>Fetched copy</title>"), nil
				})
				input, err := json.Marshal(MediaInput{Title: &seed.Title, Author: &seed.Author, Kind: &seed.Kind, URL: &seed.URL, Notes: ptr("My new note")})
				if err != nil {
					t.Fatal(err)
				}
				method, path, code := "POST", "/api/media", 201
				if operation == "patch" {
					w := owner.request("POST", "/api/media", `{"title":"Owner placeholder"}`)
					requireCode(t, w, 201)
					method, path, code = "PATCH", "/api/media/"+responseMap(t, w)["id"].(string), 200
				}
				w := owner.request(method, path, string(input))
				requireCode(t, w, code)
				var m Media
				if err = json.Unmarshal(w.Body.Bytes(), &m); err != nil {
					t.Fatal(err)
				}
				if m.Title != seed.Title || m.Author != seed.Author || m.Kind != seed.Kind || m.URL != seed.URL || m.Notes != "My new note" || m.Status != "pending" || m.Visibility != "private" || m.CompletedAt != nil || len(m.Tags) != 0 || m.CoverURL != "" || m.Description != "" {
					t.Fatalf("new copy inherited sample data: %+v", m)
				}
				// Both conflict paths must select the real ID while a sample with
				// the same key still exists (the sample was inserted first).
				w = owner.request("POST", "/api/media", string(input))
				requireCode(t, w, 409)
				if responseMap(t, w)["existing_id"] != m.ID {
					t.Fatal("create duplicate returned hidden sample ID", w.Body.String())
				}
				w = owner.request("POST", "/api/media", `{"title":"Another owner record","notes":"Keep this"}`)
				requireCode(t, w, 201)
				otherID := responseMap(t, w)["id"].(string)
				w = owner.request("PATCH", "/api/media/"+otherID, string(input))
				requireCode(t, w, 409)
				if responseMap(t, w)["existing_id"] != m.ID {
					t.Fatal("patch duplicate returned hidden sample ID", w.Body.String())
				}
				items, err := s.ListMedia(context.Background())
				if err != nil || len(items) != 2 {
					t.Fatalf("real copies missing: %+v %v", items, err)
				}
				for _, item := range items {
					if item.ID == otherID && (item.Title != "Another owner record" || item.Notes != "Keep this" || item.URL != "") {
						t.Fatalf("failed patch changed real data: %+v", item)
					}
				}
				if sampleSnapshot(t, s) != before {
					t.Fatal("copy or duplicate attempt changed sample data")
				}
			})
		}
	}
}

func TestSampleInboxSaveRelinksAtomicallyAndRemainsIdempotent(t *testing.T) {
	for _, scenario := range []string{"unlinked", "sample link", "sample link with real copy", "failed relink"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := context.Background()
			s, samples := sampleStore(t)
			var sample Media
			for _, m := range samples {
				if m.Title == "Attention Is All You Need" {
					sample = m
				}
			}
			before := sampleSnapshot(t, s)
			_, err := s.CreateSource(ctx, Source{Name: "Sample URL feed", SiteURL: "https://example.com", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60, AutoSave: true})
			if err != nil {
				t.Fatal(err)
			}
			src, lease, err := s.ClaimSource(ctx, false, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			entry := InboxItem{Title: "Fresh inbox title", Author: "Feed author", URL: sample.URL, Description: "Feed description", PublishedAt: time.Now().Add(time.Hour)}
			if err = s.FinishSource(ctx, src, lease, []InboxItem{entry}, nil); err != nil {
				t.Fatal(err)
			}
			// Quarantine never erases seen history or authorizes an auto-save.
			items, err := s.ListMedia(ctx)
			if err != nil || len(items) != 0 {
				t.Fatalf("seen sample URL auto-saved: %+v %v", items, err)
			}
			inbox, err := s.ListInbox(ctx, true)
			if err != nil || len(inbox) != 1 || inbox[0].State != "new" {
				t.Fatalf("sample URL inbox: %+v %v", inbox, err)
			}
			id := inbox[0].ID
			if scenario != "unlinked" {
				// Models links left by the old 002 save/duplicate behavior.
				if _, err = s.Pool.Exec(ctx, "UPDATE inbox SET state='saved',media_id=$2 WHERE id=$1", id, sample.ID); err != nil {
					t.Fatal(err)
				}
			}
			var existing Media
			if scenario == "sample link with real copy" {
				existing = NewMedia()
				existing.Title, existing.URL, existing.Notes = "Owner title", sample.URL, "Owner note"
				existing, err = s.CreateMedia(ctx, existing)
				if err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "failed relink" {
				// Reject only the final inbox relink, after the new media insert.
				if _, err = s.Pool.Exec(ctx, "ALTER TABLE inbox ADD CONSTRAINT test_relink_guard CHECK(media_id='"+sample.ID+"'::uuid)"); err != nil {
					t.Fatal(err)
				}
				if _, _, err = s.SaveInbox(ctx, id); err == nil {
					t.Fatal("save ignored relink failure")
				}
				items, err = s.ListMedia(ctx)
				if err != nil || len(items) != 0 {
					t.Fatalf("failed relink committed orphan media: %+v %v", items, err)
				}
				var linked, state string
				if err = s.Pool.QueryRow(ctx, "SELECT media_id::text,state FROM inbox WHERE id=$1", id).Scan(&linked, &state); err != nil || linked != sample.ID || state != "saved" {
					t.Fatalf("failed relink changed inbox: %s %s %v", linked, state, err)
				}
				if _, err = s.Pool.Exec(ctx, "ALTER TABLE inbox DROP CONSTRAINT test_relink_guard"); err != nil {
					t.Fatal(err)
				}
			}
			var wg sync.WaitGroup
			results := make(chan Media, 6)
			created := make(chan bool, 6)
			for range 6 {
				wg.Go(func() {
					m, made, err := s.SaveInbox(ctx, id)
					if err != nil {
						t.Error(err)
						return
					}
					results <- m
					created <- made
				})
			}
			wg.Wait()
			close(results)
			close(created)
			made := 0
			for value := range created {
				if value {
					made++
				}
			}
			wantCreated := 1
			if existing.ID != "" {
				wantCreated = 0
			}
			if made != wantCreated {
				t.Fatalf("concurrent saves created %d, want %d", made, wantCreated)
			}
			realID := existing.ID
			for m := range results {
				if realID == "" {
					realID = m.ID
				}
				if m.ID == sample.ID || m.ID != realID || m.Status != "pending" || m.Visibility != "private" || m.CompletedAt != nil || len(m.Tags) != 0 {
					t.Fatalf("save returned sample data/identity: %+v", m)
				}
				if existing.ID == "" && (m.Title != entry.Title || m.Author != entry.Author || m.Description != entry.Description || m.Notes != "") {
					t.Fatalf("save did not use inbox data: %+v", m)
				}
				if existing.ID != "" && (m.Title != existing.Title || m.Notes != existing.Notes) {
					t.Fatalf("relink overwrote real item: %+v", m)
				}
			}
			var linked, state string
			if err = s.Pool.QueryRow(ctx, "SELECT media_id::text,state FROM inbox WHERE id=$1", id).Scan(&linked, &state); err != nil || linked != realID || state != "saved" {
				t.Fatalf("save did not relink: %s %s %v", linked, state, err)
			}
			// Subsequent saves retain the real relationship after a URL edit.
			if _, err = s.PatchMedia(ctx, realID, MediaInput{URL: ptr("https://example.com/edited-copy")}); err != nil {
				t.Fatal(err)
			}
			if m, made, err := s.SaveInbox(ctx, id); err != nil || made || m.ID != realID || m.URL != "https://example.com/edited-copy" {
				t.Fatalf("save lost real relationship: %+v %v %v", m, made, err)
			}
			if sampleSnapshot(t, s) != before {
				t.Fatal("inbox save changed sample data")
			}
		})
	}
}

func TestSampleSubmissionsReturnVisibleRealCopies(t *testing.T) {
	for _, index := range []int{6, 7} {
		seed := historicalSeeds(t)[index]
		t.Run(seed.Title, func(t *testing.T) {
			s, _ := sampleStore(t)
			before := sampleSnapshot(t, s)
			owner, f := ownerClient(t, s)
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				return fakeResponse(r, 200, "text/html", `<title>Fetched submission</title><meta name="description" content="Fresh metadata">`), nil
			})
			w := owner.request("POST", "/api/integration/token", "")
			requireCode(t, w, 200)
			submitter := &apiTestClient{t: t, handler: owner.handler, bearer: responseMap(t, w)["token"].(string)}
			input, err := json.Marshal(map[string]any{"title": seed.Title, "author": seed.Author, "kind": seed.Kind, "url": seed.URL, "notes": "Submitted note"})
			if err != nil {
				t.Fatal(err)
			}
			w = submitter.request("POST", "/api/integrations/items", string(input))
			requireCode(t, w, 201)
			receipt := responseMap(t, w)
			if len(receipt) != 2 || receipt["created"] != true {
				t.Fatal("bad sample-copy receipt", w.Body.String())
			}
			id := receipt["id"].(string)
			for range 3 {
				w = submitter.request("POST", "/api/integrations/items", strings.ReplaceAll(string(input), "Submitted note", "Overwrite attempt"))
				requireCode(t, w, 200)
				if result := responseMap(t, w); len(result) != 2 || result["id"] != id || result["created"] != false {
					t.Fatal("duplicate submission returned sample", w.Body.String())
				}
			}
			items, err := s.ListMedia(context.Background())
			if err != nil || len(items) != 1 {
				t.Fatalf("invisible submission: %+v %v", items, err)
			}
			m := items[0]
			wantDescription := ""
			if seed.URL != "" {
				wantDescription = "Fresh metadata"
			}
			if m.ID != id || m.Title != seed.Title || m.Author != seed.Author || m.Kind != seed.Kind || m.URL != seed.URL || m.Status != "pending" || m.Visibility != "private" || m.CompletedAt != nil || m.Notes != "Submitted note" || len(m.Tags) != 0 || m.CoverURL != "" || m.Description != wantDescription {
				t.Fatalf("submission inherited/overwrote data: %+v", m)
			}
			if sampleSnapshot(t, s) != before {
				t.Fatal("submission changed sample data")
			}
		})
	}
}

func TestSampleRowsRemainHiddenFromNormalAndPublicRoutes(t *testing.T) {
	s, samples := sampleStore(t)
	owner, _ := ownerClient(t, s)
	anon := &apiTestClient{t: t, handler: owner.handler}
	// Even a historical visibility mismatch must never expose a sample.
	if _, err := s.Pool.Exec(context.Background(), "UPDATE media SET visibility='public' WHERE is_demo"); err != nil {
		t.Fatal(err)
	}
	before := sampleSnapshot(t, s)
	for _, sample := range samples {
		requireCode(t, owner.request("PATCH", "/api/media/"+sample.ID, `{"notes":"Do not change"}`), 404)
		requireCode(t, owner.request("DELETE", "/api/media/"+sample.ID, ""), 404)
		requireCode(t, anon.request("GET", "/api/public/media/"+sample.ID, ""), 404)
	}
	for _, c := range []struct {
		client *apiTestClient
		path   string
	}{{owner, "/api/media"}, {anon, "/api/public/media"}} {
		w := c.client.request("GET", c.path, "")
		requireCode(t, w, 200)
		if strings.TrimSpace(w.Body.String()) != "[]" {
			t.Fatalf("sample exposed at %s: %s", c.path, w.Body.String())
		}
	}
	w := owner.request("GET", "/api/bootstrap", "")
	requireCode(t, w, 200)
	if result := responseMap(t, w); result["legacy_sample_count"] != float64(12) || len(result["media"].([]any)) != 0 {
		t.Fatal("samples exposed in bootstrap", w.Body.String())
	}
	if sampleSnapshot(t, s) != before {
		t.Fatal("normal route mutated quarantined samples")
	}
}

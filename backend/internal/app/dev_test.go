package app

import (
	"bytes"
	"context"
	"image"
	"strings"
	"testing"
)

func TestDevFixturesRequireOptInAndOwner(t *testing.T) {
	s := integrationStore(t)
	c, f := ownerClient(t, s)
	requireCode(t, c.request("POST", "/api/dev/fixtures", ""), 404)
	srv := &Server{Store: s, Fetcher: f, Worker: NewWorker(s, f), DevMode: true}
	c.handler = srv.Handler()
	anon := &apiTestClient{t: t, handler: c.handler}
	requireCode(t, anon.request("POST", "/api/dev/fixtures", ""), 401)
	requireCode(t, c.request("POST", "/api/dev/fixtures", ""), 200)
	bootstrap := responseMap(t, c.request("GET", "/api/bootstrap", ""))
	if bootstrap["dev_mode"] != true || bootstrap["dev_fixture_count"] != float64(9) {
		t.Fatalf("development status %+v", bootstrap)
	}
	if _, err := s.Pool.Exec(context.Background(), "INSERT INTO app_settings(key,value) VALUES('other_setting','not-json')"); err != nil {
		t.Fatal(err)
	}
	requireCode(t, c.request("GET", "/api/bootstrap", ""), 200)
}

func TestDevFixturesCoverEveryKindAndCleanupPreservesRealData(t *testing.T) {
	ctx := context.Background()
	s := integrationStore(t)
	// An exact fixture lookalike stays a real item, even with the demo tag.
	real := NewMedia()
	real.Title = "[Demo] The Quiet Atlas"
	real.Author = "Margin demo studio"
	real.Kind = "book"
	real.Tags = []string{"demo"}
	real, err := s.CreateMedia(ctx, real)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		count, err := s.updateDevFixtures(ctx, false)
		if err != nil || count != 8 {
			t.Fatalf("idempotent load %d %v", count, err)
		}
	}
	items, err := s.ListMedia(ctx)
	if err != nil || len(items) != 9 {
		t.Fatalf("items=%d %v", len(items), err)
	}
	kinds := map[string]bool{}
	var done, review int
	var keptImage string
	for _, item := range items {
		kinds[item.Kind] = true
		if item.ID == real.ID {
			continue
		}
		if !strings.HasPrefix(item.Title, "[Demo]") || item.Visibility != "public" || !isImagePath(item.CoverURL) {
			t.Fatalf("unlabeled fixture %+v", item)
		}
		if item.Status == "done" {
			done++
		}
		if item.NeedsReview {
			review++
		}
		var body []byte
		if err = s.Pool.QueryRow(ctx, "SELECT body FROM images WHERE id=$1", strings.TrimPrefix(item.CoverURL, "/api/images/")).Scan(&body); err != nil {
			t.Fatal(err)
		}
		config, _, err := image.DecodeConfig(bytes.NewReader(body))
		if err != nil || config.Width == 0 {
			t.Fatalf("invalid cover %v", err)
		}
		keptImage = item.CoverURL
	}
	if len(kinds) != 9 || done == 0 || review == 0 {
		t.Fatalf("kinds=%d done=%d review=%d", len(kinds), done, review)
	}
	// Reusing a fixture image on a real item must preserve those image bytes.
	if _, err = s.Pool.Exec(ctx, "UPDATE media SET cover_url=$2 WHERE id=$1", real.ID, keptImage); err != nil {
		t.Fatal(err)
	}
	if count, err := s.updateDevFixtures(ctx, true); err != nil || count != 0 {
		t.Fatalf("cleanup %d %v", count, err)
	}
	items, err = s.ListMedia(ctx)
	if err != nil || len(items) != 1 || items[0].ID != real.ID {
		t.Fatalf("cleanup changed real data %+v %v", items, err)
	}
	var imageCount int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM images").Scan(&imageCount); err != nil || imageCount != 1 {
		t.Fatalf("reused image count %d %v", imageCount, err)
	}
	if count, err := s.devFixtureCount(ctx); err != nil || count != 0 {
		t.Fatalf("fixture count %d %v", count, err)
	}
	if _, err = s.updateDevFixtures(ctx, true); err != nil {
		t.Fatal(err)
	}
}

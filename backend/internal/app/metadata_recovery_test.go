package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

func TestBlockedArticleUsesCompletePublisherFeed(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	rssCalls := 0
	var feed strings.Builder
	feed.WriteString(`<rss version="2.0"><channel><title>OpenAI</title>`)
	for i := 0; i < 650; i++ {
		fmt.Fprintf(&feed, `<item><title>Recent %d</title><link>https://openai.com/index/recent-%d</link></item>`, i, i)
	}
	feed.WriteString(`<item><title>Scaling PostgreSQL to power 800 million ChatGPT users</title><link>https://openai.com/index/scaling-postgresql</link><description>How the database scales.</description></item></channel></rss>`)
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/news/rss.xml" {
			rssCalls++
			return fakeResponse(r, 200, "application/rss+xml", feed.String()), nil
		}
		return fakeResponse(r, 403, "text/html", "Forbidden"), nil
	})
	for range 2 {
		m, err := f.Metadata(context.Background(), "https://openai.com/index/scaling-postgresql/?utm_source=test")
		if err != nil || m.Title != "Scaling PostgreSQL to power 800 million ChatGPT users" || m.Description != "How the database scales." || m.Author != "" || m.CoverURL != "" || m.Warning == "" {
			t.Fatalf("publisher fallback %+v %v", m, err)
		}
	}
	if rssCalls != 1 {
		t.Fatalf("feed cache fetched %d times", rssCalls)
	}
}
func TestArticleStructuredMetadata(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"A useful article","author":[{"name":"First writer"},{"name":"Second writer"}],"image":[{"@type":"ImageObject","url":"/image.jpg"}],"description":"<p>Article details.</p>"}]}</script>`), nil
	})
	m, err := f.Metadata(context.Background(), "https://publisher.example/story")
	if err != nil || m.Kind != "article" || m.Title != "A useful article" || m.Author != "First writer, Second writer" || m.Description != "Article details." || m.CoverURL != "https://publisher.example/image.jpg" {
		t.Fatalf("article JSON-LD %+v %v", m, err)
	}
}
func TestImmediateCaptureEnrichesWithoutOverwritingEdits(t *testing.T) {
	s := integrationStore(t)
	c, f := ownerClient(t, s)
	var calls atomic.Int32
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return fakeResponse(r, 200, "text/html", `<title>Publisher title</title><meta name="author" content="Publisher writer"><meta name="description" content="Publisher description"><meta property="og:image" content="https://publisher.example/image.jpg">`), nil
	})
	w := c.request("POST", "/api/media", `{"url":"https://publisher.example/story","fetch_metadata":true}`)
	requireCode(t, w, 201)
	item := responseMap(t, w)
	id := item["id"].(string)
	if item["metadata_state"] != "pending" || calls.Load() != 0 {
		t.Fatalf("save waited for metadata: %s", w.Body.String())
	}
	requireCode(t, c.request("PATCH", "/api/media/"+id, `{"title":"My correction","notes":"Private note","visibility":"public","status":"done","needs_review":true}`), 200)
	NewWorker(s, f).enrichPending(context.Background())
	items, err := s.ListMedia(context.Background())
	if err != nil || len(items) != 1 {
		t.Fatal(err)
	}
	m := items[0]
	if m.Title != "My correction" || m.Author != "Publisher writer" || m.Description != "Publisher description" || m.CoverURL == "" || m.MetadataState != "ready" || m.Status != "done" || !m.NeedsReview || m.Visibility != "public" || m.Notes != "Private note" {
		t.Fatalf("enrichment lost edits %+v", m)
	}
	public := c.request("GET", "/api/public/media/"+id, "").Body.String()
	if strings.Contains(public, "metadata_state") || strings.Contains(public, "metadata_warning") || strings.Contains(public, "Private note") {
		t.Fatal("public metadata operational leak")
	}
}
func TestMetadataCompletionRespectsEditsDuringFetchAndURLChanges(t *testing.T) {
	for _, changeURL := range []bool{false, true} {
		t.Run(fmt.Sprint(changeURL), func(t *testing.T) {
			s := integrationStore(t)
			c, f := ownerClient(t, s)
			created := c.request("POST", "/api/media", `{"url":"https://publisher.example/original","fetch_metadata":true}`)
			requireCode(t, created, 201)
			id := responseMap(t, created)["id"].(string)
			started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/different" {
					return fakeResponse(r, 200, "text/html", `<title>Different publisher title</title><meta name="description" content="Different description">`), nil
				}
				close(started)
				<-release
				return fakeResponse(r, 200, "text/html", `<title>Fetched title</title><meta name="description" content="Fetched description">`), nil
			})
			go func() { defer close(done); NewWorker(s, f).enrichPending(context.Background()) }()
			<-started
			patch := `{"title":"Edited during fetch","description":"My own description"}`
			if changeURL {
				patch = `{"url":"https://publisher.example/different","title":"Different page"}`
			}
			requireCode(t, c.request("PATCH", "/api/media/"+id, patch), 200)
			close(release)
			<-done
			items, err := s.ListMedia(context.Background())
			if err != nil || len(items) != 1 {
				t.Fatal(err)
			}
			if changeURL {
				if items[0].Title != "Different page" || items[0].Description != "Different description" {
					t.Fatalf("old URL metadata applied %+v", items[0])
				}
			} else if items[0].Title != "Edited during fetch" || items[0].Description != "My own description" {
				t.Fatalf("concurrent edits lost %+v", items[0])
			}
		})
	}
}
func TestBrowserPageMetadataRecoversBlockedCapture(t *testing.T) {
	s := integrationStore(t)
	c, f := ownerClient(t, s)
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 403, "text/html", "Forbidden"), nil
	})
	token := responseMap(t, c.request("POST", "/api/integration/browser-token", ""))["token"].(string)
	c.bearer = token
	w := c.request("POST", "/api/integrations/capture", `{"url":"https://publisher.example/story","action":"save","page_metadata":{"title":"Title from current page","author":"Writer","description":"Description from current page","cover_url":"https://publisher.example/cover.jpg"}}`)
	requireCode(t, w, 201)
	if responseMap(t, w)["warning"] != nil {
		t.Fatalf("recovered capture reported failure %s", w.Body.String())
	}
	items, err := s.ListMedia(context.Background())
	if err != nil || len(items) != 1 || items[0].Title != "Title from current page" || items[0].CoverURL == "" || items[0].MetadataState != "ready" {
		t.Fatalf("browser fallback %+v %v", items, err)
	}
	requireCode(t, c.request("PATCH", "/api/media/"+items[0].ID, `{"metadata_warning":"Owner private diagnostic text"}`), 200)
	duplicate := c.request("POST", "/api/integrations/capture", `{"url":"https://publisher.example/story","action":"save"}`)
	requireCode(t, duplicate, 200)
	if strings.Contains(duplicate.Body.String(), "Owner private") || responseMap(t, duplicate)["warning"] != nil {
		t.Fatalf("duplicate warning leaked: %s", duplicate.Body.String())
	}
}

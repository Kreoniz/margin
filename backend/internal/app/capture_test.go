package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBookISBNAndStructuredMetadata(t *testing.T) {
	for _, isbn := range []string{"978-0-13-235088-4", "0132350882", "0-8044-2957-X"} {
		if validISBN(isbn) == "" {
			t.Errorf("valid ISBN %s", isbn)
		}
	}
	for _, isbn := range []string{"9780132350885", "0132350883", "abcdefghij", "123"} {
		if validISBN(isbn) != "" {
			t.Errorf("invalid ISBN %s", isbn)
		}
	}
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Book shop</title><script type="application/ld+json">{"@graph":[{"@type":["Product","Book"],"name":"Exact edition","author":[{"name":"A. Writer"}],"isbn":"9780132350884","image":{"url":"/cover.jpg"},"description":"<p>A book.</p>"}]}</script>`), nil
	})
	m, err := f.Metadata(context.Background(), "https://publisher.example/edition")
	if err != nil || m.Kind != "book" || m.Title != "Exact edition" || m.Author != "A. Writer" || m.CoverURL != "https://publisher.example/cover.jpg" || m.Description != "A book." {
		t.Fatalf("structured book %+v %v", m, err)
	}
}
func TestBookSearchSelectsRelevantEditionAndCaches(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	calls := 0
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Query().Get("q") != "isbn:9780132350884" {
			t.Fatal(r.URL)
		}
		return fakeResponse(r, 200, "application/json", `{"docs":[{"key":"/works/OL1W","title":"Work title","author_name":["Writer"],"cover_i":1,"editions":{"docs":[{"key":"/books/OL2M","title":"Matched edition","cover_i":2}]}},{"key":"//evil.example/","title":"Unsafe"}]}`), nil
	})
	for range 2 {
		items, err := f.Books(context.Background(), "9780132350884", "")
		if err != nil || len(items) != 1 || items[0].Title != "Matched edition" || items[0].URL != "https://openlibrary.org/books/OL2M" || !strings.Contains(items[0].CoverURL, "/2-L.jpg") {
			t.Fatalf("matches %+v %v", items, err)
		}
	}
	if calls != 1 {
		t.Fatal("book search was not cached")
	}
}

func TestCapturePermissionsReviewDuplicatesAndCompletion(t *testing.T) {
	s := integrationStore(t)
	c, f := ownerClient(t, s)
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Captured title</title>`), nil
	})
	browser := responseMap(t, c.request("POST", "/api/integration/browser-token", ""))["token"].(string)
	submission := responseMap(t, c.request("POST", "/api/integration/token", ""))["token"].(string)
	request := func(token, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Origin", "chrome-extension://test")
		w := httptest.NewRecorder()
		c.handler.ServeHTTP(w, r)
		return w
	}
	requireCode(t, request(submission, "/api/integrations/capture", `{"url":"https://example.com/article","action":"done"}`), 401)
	requireCode(t, request("", "/api/integrations/capture", `{"url":"https://example.com/article","action":"done"}`), 401)
	w := request(browser, "/api/integrations/capture", `{"url":"https://example.com/article?utm_source=extension","action":"save"}`)
	requireCode(t, w, 201)
	id := responseMap(t, w)["id"].(string)
	if strings.Contains(w.Body.String(), "title") || strings.Contains(w.Body.String(), "notes") {
		t.Fatal("capture receipt exposed library data")
	}
	m, err := scanMedia(s.Pool.QueryRow(context.Background(), "SELECT "+mediaColumns+" FROM media WHERE id=$1", id))
	if err != nil || !m.NeedsReview || m.Status != "pending" || m.Visibility != "private" {
		t.Fatalf("capture %+v %v", m, err)
	}
	requireCode(t, c.request("PATCH", "/api/media/"+id, `{"title":"Owner correction","notes":"Private note","needs_review":false,"visibility":"public"}`), 200)
	w = request(browser, "/api/integrations/capture", `{"url":"http://www.example.com/article/","action":"done"}`)
	requireCode(t, w, 200)
	items, err := s.ListMedia(context.Background())
	if err != nil || len(items) != 1 || items[0].Status != "done" || items[0].NeedsReview || items[0].Title != "Owner correction" || items[0].Visibility != "public" {
		t.Fatalf("duplicate changed details %+v %v", items, err)
	}
	requireCode(t, request(browser, "/api/integrations/capture", `{"url":"https://example.com/new","action":"save","visibility":"public"}`), 400)
	requireCode(t, c.request("DELETE", "/api/integration/browser-token", ""), 204)
	requireCode(t, request(browser, "/api/integrations/capture", `{"url":"https://example.com/article","action":"done"}`), 401)
	// The existing submission credential still works, but still cannot choose status.
	r := httptest.NewRequest("POST", "/api/integrations/items", strings.NewReader(`{"title":"Via bot"}`))
	r.Header.Set("Authorization", "Bearer "+submission)
	w = httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	requireCode(t, w, 201)
	requireCode(t, c.request("GET", "/api/public/media/"+id, ""), 200)
	public := c.request("GET", "/api/public/media/"+id, "").Body.String()
	if strings.Contains(public, "needs_review") || strings.Contains(public, "Private note") {
		t.Fatal("public operational data leak")
	}
}
func TestImagesPrivacyAndPortableExport(t *testing.T) {
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	anon := &apiTestClient{t: t, handler: c.handler}
	var body bytes.Buffer
	_ = png.Encode(&body, image.NewRGBA(image.Rect(0, 0, 20, 30)))
	upload := func(content []byte, owner bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/images", bytes.NewReader(content))
		if owner {
			r.AddCookie(c.cookie)
		}
		w := httptest.NewRecorder()
		c.handler.ServeHTTP(w, r)
		return w
	}
	requireCode(t, upload(body.Bytes(), false), 401)
	requireCode(t, upload([]byte(`<svg onload="alert(1)"/>`), true), 400)
	w := upload(body.Bytes(), true)
	requireCode(t, w, 201)
	path := responseMap(t, w)["url"].(string)
	requireCode(t, anon.request("GET", path, ""), 404)
	encoded, _ := json.Marshal(map[string]any{"title": "With image", "cover_url": path, "notes": "Keep private"})
	w = c.request("POST", "/api/media", string(encoded))
	requireCode(t, w, 201)
	id := responseMap(t, w)["id"].(string)
	requireCode(t, c.request("GET", path, ""), 200)
	requireCode(t, anon.request("GET", path, ""), 404)
	requireCode(t, c.request("PATCH", "/api/media/"+id, `{"visibility":"public"}`), 200)
	requireCode(t, anon.request("GET", path, ""), 200)
	requireCode(t, c.request("PATCH", "/api/media/"+id, `{"visibility":"private"}`), 200)
	requireCode(t, anon.request("GET", path, ""), 404)
	requireCode(t, anon.request("GET", "/api/export", ""), 401)
	w = c.request("GET", "/api/export", "")
	requireCode(t, w, 200)
	archive, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, file := range archive.File {
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name], err = io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	var library struct {
		Version int
		Media   []Media
	}
	if err = json.Unmarshal(files["library.json"], &library); err != nil || library.Version != 1 || len(library.Media) != 1 {
		t.Fatalf("export %+v %v", library, err)
	}
	cover := library.Media[0].CoverURL
	if !strings.HasPrefix(cover, "images/") || len(files[cover]) == 0 || library.Media[0].Notes != "Keep private" {
		t.Fatalf("missing portable image or notes %+v", library)
	}
}

func TestBookLinkEnrichmentKeepsExactPublisherEdition(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Hostname() == "openlibrary.org" {
			if r.URL.Query().Get("q") != "isbn:9780132350884" {
				t.Fatal("did not use publisher ISBN", r.URL)
			}
			return fakeResponse(r, 200, "application/json", `{"docs":[{"key":"/works/OL1W","title":"Different catalogue title","author_name":["Catalogue writer"],"cover_i":1}]}`), nil
		}
		return fakeResponse(r, 200, "text/html", `<script type="application/ld+json">{"@type":"Book","name":"Publisher exact edition","isbn":"9780132350884","author":{"name":"Publisher writer"}}</script>`), nil
	})
	m, err := f.Metadata(context.Background(), "https://publisher.example/book")
	if err != nil || m.Title != "Publisher exact edition" || m.Author != "Publisher writer" || m.CoverURL == "" {
		t.Fatalf("enriched publisher %+v %v", m, err)
	}
}

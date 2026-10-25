package app

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRSSAndAtom(t *testing.T) {
	now := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)
	rss := `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Publisher</title><link>https://example.com/</link><item><title>A &amp; B</title><link>https://example.com/a?utm_source=x</link><description><![CDATA[<p>Clean text.</p><script>bad()</script>]]></description><pubDate>Fri, 23 Oct 2026 12:00:00 GMT</pubDate><media:thumbnail url="https://example.com/a.jpg"/></item><item><title>Duplicate</title><link>http://www.example.com/a</link></item><item><title>Private</title><link>http://127.0.0.1/x</link></item><item><title>Script</title><link>javascript:alert(1)</link></item></channel></rss>`
	items, err := ParseFeed([]byte(rss), "https://example.com/feed", now)
	if err != nil || len(items) != 1 {
		t.Fatalf("RSS: %+v %v", items, err)
	}
	if items[0].Title != "A & B" || items[0].Description != "Clean text." || items[0].CoverURL != "https://example.com/a.jpg" || items[0].PublishedAt.Hour() != 12 {
		t.Fatalf("RSS fields: %+v", items[0])
	}
	atom := `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><author><name>Publisher</name></author><entry><title>An entry</title><link href="/article" rel="alternate"/><updated>2026-10-22T10:00:00Z</updated><content type="html">&lt;p&gt;Readable.&lt;/p&gt;</content><author><name>Writer</name></author></entry></feed>`
	items, err = ParseFeed([]byte(atom), "https://example.com/atom.xml", now)
	if err != nil || len(items) != 1 || items[0].URL != "https://example.com/article" || items[0].Author != "Writer" || items[0].Description != "Readable." {
		t.Fatalf("Atom: %+v %v", items, err)
	}
	if _, err = ParseFeed([]byte(`<html>No feed</html>`), "https://example.com/", now); err == nil {
		t.Fatal("non-feed accepted")
	}
}

func TestAnthropicSemanticListing(t *testing.T) {
	body := `<main><nav><a href="/news/product">Product</a></nav><ul><li data-listing-row="1"><div><a href="/claude-opus-5-5"><h3>A new model</h3></a><a href="/claude-opus-5-5"><p>A short announcement.</p></a><time>Oct 22, 2026</time></div></li><li data-listing-row="2"><a href="https://evil.example.com/news/attack"><h3>Wrong origin</h3></a><time>Oct 22, 2026</time></li><li data-listing-row="3"><a href="/claude-opus-5-5"><h3>Duplicate</h3></a><time>Oct 22, 2026</time></li><li data-listing-row="4"><a href="/news/another"><h3>Another article</h3></a><time datetime="2026-10-21">Yesterday</time></li></ul></main>`
	items, err := ParseAnthropic([]byte(body), "https://www.anthropic.com/news", time.Now())
	if err != nil || len(items) != 2 {
		t.Fatalf("Anthropic: %+v %v", items, err)
	}
	if items[0].Title != "A new model" || items[0].Description != "A short announcement." || items[0].PublishedAt.Day() != 22 || items[0].PublishedAt.Hour() != 0 {
		t.Fatalf("fields: %+v", items[0])
	}
	if _, err = ParseAnthropic([]byte(`<main>No rows</main>`), "https://www.anthropic.com/news", time.Now()); err == nil {
		t.Fatal("empty markup silently succeeded")
	}
	if _, err = ParseAnthropic([]byte(body), "https://evil.example.com/news", time.Now()); err == nil {
		t.Fatal("third-party fallback allowed")
	}
}

func TestAnthropicPublicationDates(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	future := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name, dateMarkup string
		published        time.Time
		unknown          bool
	}{
		{"malformed datetime", `<time datetime="not-a-date">Earlier</time>`, now, true},
		{"malformed text", `<time>not-a-date</time>`, now, true},
		{"missing date", `<time></time>`, now, true},
		{"blank date", `<time datetime=" "> </time>`, now, true},
		{"known future datetime", `<time datetime="2026-10-24">Tomorrow</time>`, future, false},
		{"known future text", `<time>Oct 24, 2026</time>`, future, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := `<main><ul><li data-listing-row="1"><a href="/news/test"><h3>Article</h3></a>` + tc.dateMarkup + `</li></ul></main>`
			items, err := ParseAnthropic([]byte(body), "https://www.anthropic.com/news", now)
			if err != nil || len(items) != 1 {
				t.Fatalf("Anthropic: %+v %v", items, err)
			}
			if !items[0].PublishedAt.Equal(tc.published) || items[0].PublishedUnknown != tc.unknown {
				t.Fatalf("publication: %s unknown=%t, want %s unknown=%t", items[0].PublishedAt, items[0].PublishedUnknown, tc.published, tc.unknown)
			}
		})
	}
}

func TestDiscovery(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/feed.xml" {
			return fakeResponse(r, 200, "text/xml", `<rss version="2.0"><channel><title>My feed</title><link>https://example.com/</link></channel></rss>`), nil
		}
		return fakeResponse(r, 200, "text/html", `<link rel="alternate" type="application/atom+xml" href="/feed.xml">`), nil
	})
	src, err := f.DiscoverSource(context.Background(), "https://example.com/blog", "", 60)
	if err != nil || src.FeedURL != "https://example.com/feed.xml" || src.Name != "My feed" || src.Parser != "rss" {
		t.Fatalf("discovery: %+v %v", src, err)
	}
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<p>No feed here</p>`), nil
	})
	if _, err = f.DiscoverSource(context.Background(), "https://example.com/", "", 60); err == nil || !strings.Contains(err.Error(), "No supported") {
		t.Fatalf("unsupported HTML: %v", err)
	}
}

func TestDiscoveryAndCollectionResolveDirectoryLinks(t *testing.T) {
	for _, feed := range []struct {
		name string
		body string
	}{
		{"RSS", `<rss version="2.0"><channel><title>Directory feed</title><link>../</link><item><title>Article</title><link>articles/first/</link><enclosure url="images/cover.jpg" type="image/jpeg"/></item><item><title>Duplicate</title><link>articles/first</link></item></channel></rss>`},
		{"Atom", `<feed xmlns="http://www.w3.org/2005/Atom"><title>Directory feed</title><link href="../"/><entry><title>Article</title><link href="articles/first/"/><link rel="enclosure" href="images/cover.jpg" type="image/jpeg"/></entry><entry><title>Duplicate</title><link href="articles/first"/></entry></feed>`},
	} {
		t.Run(feed.name, func(t *testing.T) {
			f := NewFetcher()
			defer f.Close()
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				switch r.URL.Path {
				case "/start":
					res := fakeResponse(r, 302, "text/html", "")
					res.Header.Set("Location", "/blog/")
					return res, nil
				case "/blog/":
					return fakeResponse(r, 200, "text/html", `<link rel="alternate" type="application/atom+xml" href="feed.xml">`), nil
				case "/blog/feed.xml":
					res := fakeResponse(r, 302, "text/xml", "")
					res.Header.Set("Location", "feeds/")
					return res, nil
				case "/blog/feeds/":
					return fakeResponse(r, 200, "text/xml", feed.body), nil
				default:
					t.Errorf("incorrect relative request: %s", r.URL)
					return fakeResponse(r, 404, "text/plain", "missing"), nil
				}
			})
			src, err := f.DiscoverSource(context.Background(), "https://example.com/start", "", 60)
			if err != nil || src.FeedURL != "https://example.com/blog/feeds/" || src.SiteURL != "https://example.com/blog/" {
				t.Fatalf("directory discovery: %+v %v", src, err)
			}
			items, err := f.Collect(context.Background(), src)
			if err != nil || len(items) != 1 {
				t.Fatalf("directory collection: %+v %v", items, err)
			}
			if items[0].URL != "https://example.com/blog/feeds/articles/first/" || items[0].CoverURL != "https://example.com/blog/feeds/images/cover.jpg" {
				t.Fatalf("relative item links: %+v", items[0])
			}
		})
	}
}

// Optional smoke check uses a previously downloaded first-party snapshot; it
// performs no network I/O and is not needed for the deterministic test suite.
func TestAnthropicSnapshot(t *testing.T) {
	p := os.Getenv("ANTHROPIC_HTML_FIXTURE")
	if p == "" {
		t.Skip("set ANTHROPIC_HTML_FIXTURE for a local first-party HTML snapshot")
	}
	body, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	items, err := ParseAnthropic(body, "https://www.anthropic.com/news", time.Now())
	if err != nil || len(items) < 10 {
		t.Fatalf("snapshot produced %d items: %v", len(items), err)
	}
	t.Logf("parsed %d first-party listing items", len(items))
}

func TestLiveDefaultSources(t *testing.T) {
	if os.Getenv("MARGIN_LIVE_SOURCES") != "true" {
		t.Skip("set MARGIN_LIVE_SOURCES=true to verify current first-party publisher endpoints")
	}
	f := NewFetcher()
	t.Cleanup(f.Close)
	for _, src := range DefaultSources() {
		t.Run(src.Name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			items, err := f.Collect(ctx, src)
			if err != nil || len(items) == 0 {
				t.Fatalf("live collection: %d items, %v", len(items), err)
			}
			t.Logf("collected %d items; newest: %s", len(items), items[0].Title)
		})
	}
}

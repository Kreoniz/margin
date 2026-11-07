package app

import (
	"context"
	"net/http"
	"testing"
)

func TestBookSearchAcceptsBothCatalogueIDFormats(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "application/json", `{"docs":[{"key":"OL19293745W","title":"Designing Data-Intensive Applications","author_name":["Martin Kleppmann"],"editions":{"docs":[{"key":"OL48030878M","title":"Designing Data-Intensive Applications","cover_i":15096047}]}},{"key":"OL1W","title":"Work only"},{"key":"https://evil.example/OL1W","title":"Unsafe"}]}`), nil
	})
	items, err := f.Books(context.Background(), "Designing data intensive applications", "")
	if err != nil || len(items) != 2 || items[0].Author != "Martin Kleppmann" || items[0].URL != "https://openlibrary.org/books/OL48030878M" || items[1].URL != "https://openlibrary.org/works/OL1W" {
		t.Fatalf("unexpected results: %+v %v", items, err)
	}
}

func TestBookEmptyResultsCanBeRetried(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	calls := 0
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"docs":[]}`
		if calls > 1 {
			body = `{"docs":[{"key":"/works/OL19293745W","title":"Designing Data-Intensive Applications"}]}`
		}
		return fakeResponse(r, 200, "application/json", body), nil
	})
	items, err := f.Books(context.Background(), "Designing data intensive applications", "")
	if err != nil || len(items) != 0 {
		t.Fatalf("first attempt: %+v %v", items, err)
	}
	items, err = f.Books(context.Background(), "Designing data intensive applications", "")
	if err != nil || len(items) != 1 || calls != 2 {
		t.Fatalf("retry: %+v %v calls=%d", items, err, calls)
	}
}

func TestBookMalformedCatalogueIsNotANegativeMatch(t *testing.T) {
	for _, body := range []string{`{"error":"temporarily unavailable"}`, `{"docs":null}`, `{"docs":[{"key":"bad","title":"Invalid result"}]}`} {
		f := NewFetcher()
		f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return fakeResponse(r, 200, "application/json", body), nil
		})
		_, err := f.Books(context.Background(), "A title", "")
		f.Close()
		if err == nil {
			t.Fatalf("accepted invalid response: %s", body)
		}
	}
}

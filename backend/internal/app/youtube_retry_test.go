package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
)

func TestYouTubeMetadataRetriesTransientFailureWithinOneExtraAttempt(t *testing.T) {
	for _, failure := range []error{io.EOF, io.ErrUnexpectedEOF, context.DeadlineExceeded} {
		t.Run(failure.Error(), func(t *testing.T) {
			f := NewFetcher()
			defer f.Close()
			calls := 0
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Host != "www.youtube.com" || r.URL.Path != "/oembed" {
					t.Fatalf("unexpected endpoint: %s", r.URL)
				}
				if calls == 1 {
					return nil, failure
				}
				return fakeResponse(r, 200, "application/json", `{"title":"How To Give Claude Unlimited Usage","author_name":"Theo","type":"video","thumbnail_url":"https://i.ytimg.com/vi/NBCM_ZoWZo8/hqdefault.jpg"}`), nil
			})
			input := "https://youtu.be/NBCM_ZoWZo8"
			m, ok := f.youtubeMetadata(context.Background(), input, "NBCM_ZoWZo8")
			if !ok || calls != 2 || m.Title != "How To Give Claude Unlimited Usage" || m.Author != "Theo" || m.CoverURL == "" || m.URL != input || m.Warning != "" {
				t.Fatalf("recovery failed: calls=%d ok=%v metadata=%+v", calls, ok, m)
			}
		})
	}
}

func TestYouTubeMetadataRetryIsBoundedAndKeepsRefusalsHonest(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		status    int
		body      string
		err       error
		wantCalls int
	}{
		{"repeated connection failure", 0, "", io.EOF, 2},
		{"private video", 401, "unavailable", nil, 1},
		{"restriction", 403, "unavailable", nil, 1},
		{"missing video", 404, "unavailable", nil, 1},
		{"invalid JSON", 200, "not metadata", nil, 1},
		{"invalid title", 200, `{"type":"video","title":""}`, nil, 1},
		{"certificate error", 0, "", errors.New("certificate verification failed"), 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := NewFetcher()
			defer f.Close()
			calls := 0
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if scenario.err != nil {
					return nil, scenario.err
				}
				return fakeResponse(r, scenario.status, "application/json", scenario.body), nil
			})
			if _, ok := f.youtubeMetadata(context.Background(), "https://youtu.be/NBCM_ZoWZo8", "NBCM_ZoWZo8"); ok || calls != scenario.wantCalls {
				t.Fatalf("unexpected result: ok=%v calls=%d want=%d", ok, calls, scenario.wantCalls)
			}
		})
	}
	f := NewFetcher()
	defer f.Close()
	calls := 0
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { calls++; return nil, io.EOF })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := f.youtubeMetadata(ctx, "https://youtu.be/NBCM_ZoWZo8", "NBCM_ZoWZo8"); ok || calls != 0 {
		t.Fatalf("canceled lookup made a request: ok=%v calls=%d", ok, calls)
	}
}

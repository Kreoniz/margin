package app

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestIntegrationWorkerQueuesForcedPassDuringScheduledCollection(t *testing.T) {
	s := integrationStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, name := range []string{"due", "fresh", "disabled"} {
		src, err := s.CreateSource(ctx, Source{Name: name, SiteURL: "https://example.com/", FeedURL: "https://example.com/" + name, Parser: "rss", IntervalMinutes: 60})
		if err != nil {
			t.Fatal(err)
		}
		if name == "fresh" {
			if _, err = s.Pool.Exec(ctx, "UPDATE sources SET last_sync=now(),next_sync=now()+interval '1 hour' WHERE id=$1", src.ID); err != nil {
				t.Fatal(err)
			}
		}
		if name == "disabled" {
			if _, err = s.PatchSource(ctx, src.ID, SourcePatch{Enabled: ptr(false)}); err != nil {
				t.Fatal(err)
			}
		}
	}
	f := NewFetcher()
	t.Cleanup(f.Close)
	scheduledStarted := make(chan struct{})
	releaseScheduled := make(chan struct{})
	forcedStarted := make(chan struct{})
	releaseForced := make(chan struct{})
	var calls, dueCalls, freshCalls atomic.Int32
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/due":
			dueCalls.Add(1)
		case "/fresh":
			freshCalls.Add(1)
		default:
			t.Errorf("worker fetched disabled or unknown source: %s", r.URL)
		}
		var release <-chan struct{}
		switch calls.Add(1) {
		case 1:
			if r.URL.Path != "/due" {
				t.Errorf("scheduled pass ignored interval: %s", r.URL)
			}
			close(scheduledStarted)
			release = releaseScheduled
		case 2:
			close(forcedStarted)
			release = releaseForced
		}
		if release != nil {
			select {
			case <-release:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
		}
		return fakeResponse(r, 200, "application/rss+xml", `<rss version="2.0"><channel><title>Feed</title></channel></rss>`), nil
	})
	w := NewWorker(s, f)
	go w.Run(ctx)
	t.Cleanup(func() {
		cancel()
		select {
		case <-w.Done():
		case <-time.After(5 * time.Second):
			t.Error("worker did not shut down")
		}
	})
	waitStarted := func(ch <-chan struct{}, name string) {
		t.Helper()
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
			t.Fatalf("%s did not start", name)
		}
	}
	triggerBurst := func() {
		var wg sync.WaitGroup
		for range 50 {
			wg.Go(w.Trigger)
		}
		wg.Wait()
	}
	waitStarted(scheduledStarted, "scheduled pass")
	triggerBurst()
	close(releaseScheduled)
	waitStarted(forcedStarted, "pending forced pass")
	triggerBurst()
	if len(w.trigger) != 0 {
		t.Fatal("manual triggers queued another pass while a forced pass was active")
	}
	close(releaseForced)
	waitIdle := func(wantCalls int32) {
		t.Helper()
		deadline := time.NewTimer(5 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for w.busy.Load() || calls.Load() < wantCalls {
			select {
			case <-deadline.C:
				t.Fatalf("worker did not become idle: calls=%d, want %d", calls.Load(), wantCalls)
			case <-ticker.C:
			}
		}
		if calls.Load() != wantCalls || len(w.trigger) != 0 {
			t.Fatalf("manual sync storm: calls=%d, want %d, pending=%d", calls.Load(), wantCalls, len(w.trigger))
		}
	}
	waitIdle(3)
	if dueCalls.Load() != 2 || freshCalls.Load() != 1 {
		t.Fatalf("forced pass did not check all enabled sources: due=%d fresh=%d", dueCalls.Load(), freshCalls.Load())
	}
	// A subsequent request after the pass ends must still be accepted.
	w.Trigger()
	waitIdle(5)
	if dueCalls.Load() != 3 || freshCalls.Load() != 2 {
		t.Fatalf("new idle trigger was lost: due=%d fresh=%d", dueCalls.Load(), freshCalls.Load())
	}
}

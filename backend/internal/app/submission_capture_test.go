package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func submissionClient(t *testing.T, owner *apiTestClient) *apiTestClient {
	t.Helper()
	w := owner.request("POST", "/api/integration/token", "")
	requireCode(t, w, 200)
	return &apiTestClient{t: t, handler: owner.handler, bearer: responseMap(t, w)["token"].(string)}
}

func submissionMedia(t *testing.T, s *Store, id string) Media {
	t.Helper()
	m, err := scanMedia(s.Pool.QueryRow(context.Background(), "SELECT "+mediaColumns+" FROM media WHERE id=$1 AND NOT is_demo", id))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func requireSubmissionReceipt(t *testing.T, w *httptest.ResponseRecorder, code int, existingID string) string {
	t.Helper()
	requireCode(t, w, code)
	receipt := responseMap(t, w)
	id, ok := receipt["id"].(string)
	if !ok || !validID(id) || len(receipt) != 2 || receipt["created"] != (code == 201) || existingID != "" && id != existingID {
		t.Fatalf("invalid submission receipt: %s", w.Body.String())
	}
	return id
}

func TestSubmissionPersistsBeforePublisherAndDuplicatesDoNotFetch(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	submitter := submissionClient(t, owner)
	worker := NewWorker(s, f)
	submitter.handler = (&Server{Store: s, Fetcher: f, Worker: worker}).Handler()
	started, release := make(chan struct{}, 1), make(chan struct{})
	var calls atomic.Int32
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return fakeResponse(r, 503, "text/html", "Unavailable"), nil
	})
	var requests sync.WaitGroup
	defer func() { close(release); requests.Wait() }()
	submit := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		result := make(chan *httptest.ResponseRecorder, 1)
		requests.Go(func() { result <- submitter.request("POST", "/api/integrations/items", body) })
		select {
		case w := <-result:
			return w
		case <-started:
			t.Fatal("submission fetched the publisher before returning its durable receipt")
		case <-time.After(5 * time.Second):
			t.Fatal("submission did not return a receipt")
		}
		return nil
	}

	id := requireSubmissionReceipt(t, submit(`{"url":"https://publisher.example/story#section"}`), 201, "")
	m := submissionMedia(t, s, id)
	if m.URL != "https://publisher.example/story#section" || m.Title == "" || m.MetadataState != "pending" || m.Status != "pending" || m.Visibility != "private" || m.NeedsReview || m.AutoAdded || m.CompletedAt != nil || calls.Load() != 0 {
		t.Fatalf("receipt preceded durable private pending capture: %+v, publisher calls=%d", m, calls.Load())
	}
	select {
	case <-worker.metadataTrigger:
	default:
		t.Fatal("new pending submission did not wake the metadata worker")
	}
	duplicate := `{"url":"http://www.publisher.example/story/?utm_source=test","title":"Overwrite attempt","notes":"Different note"}`
	requireSubmissionReceipt(t, submit(duplicate), 200, id)
	if after := submissionMedia(t, s, id); !reflect.DeepEqual(after, m) {
		t.Fatalf("duplicate changed pending capture: before=%+v after=%+v", m, after)
	}
	select {
	case <-worker.metadataTrigger:
		t.Fatal("duplicate woke the metadata worker")
	default:
	}

	requireCode(t, owner.request("PATCH", "/api/media/"+id, `{"title":"Owner title","author":"Owner author","kind":"paper","url":"https://publisher.example/story#private-owner-fragment","cover_url":"https://publisher.example/owner.jpg","description":"Owner description","notes":"Private owner note","tags":["owner"],"status":"done","visibility":"public","needs_review":false,"metadata_warning":"Private diagnostic"}`), 200)
	before := submissionMedia(t, s, id)
	requireSubmissionReceipt(t, submit(duplicate), 200, id)
	if after := submissionMedia(t, s, id); !reflect.DeepEqual(after, before) || calls.Load() != 0 {
		t.Fatalf("duplicate fetched publisher or changed owner fields: before=%+v after=%+v calls=%d", before, after, calls.Load())
	}
}

func TestSubmissionEnrichmentPreservesHintsAndConcurrentOwnerEdits(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	submitter := submissionClient(t, owner)
	started, release := make(chan struct{}), make(chan struct{})
	holdLookup := false
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/edited" && holdLookup {
			close(started)
			select {
			case <-release:
			case <-r.Context().Done():
				return nil, r.Context().Err()
			}
		}
		return fakeResponse(r, 200, "text/html", `<title>Publisher title</title><meta name="author" content="Publisher author"><meta property="og:type" content="video"><meta name="description" content="Publisher description"><meta property="og:image" content="https://publisher.example/publisher.jpg">`), nil
	})
	id := requireSubmissionReceipt(t, submitter.request("POST", "/api/integrations/items", `{"url":"https://publisher.example/hints","title":"Explicit title","author":"Explicit author","kind":"other","tags":["hint"],"notes":"Submitted note"}`), 201, "")
	NewWorker(s, f).enrichPending(context.Background())
	m := submissionMedia(t, s, id)
	if m.Title != "Explicit title" || m.Author != "Explicit author" || m.Kind != "other" || !m.KindExplicit || m.Description != "Publisher description" || m.CoverURL != "https://publisher.example/publisher.jpg" || m.MetadataState != "ready" || m.Notes != "Submitted note" || !reflect.DeepEqual(m.Tags, []string{"hint"}) || m.Status != "pending" || m.Visibility != "private" || m.NeedsReview {
		t.Fatalf("enrichment replaced explicit hints or failed to fill missing fields: %+v", m)
	}

	id = requireSubmissionReceipt(t, submitter.request("POST", "/api/integrations/items", `{"url":"https://publisher.example/edited"}`), 201, "")
	holdLookup = true
	done := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	go func() { defer close(done); NewWorker(s, f).enrichPending(ctx) }()
	defer func() { cancel(); <-done }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("deferred metadata lookup did not start")
	}
	requireCode(t, owner.request("PATCH", "/api/media/"+id, `{"title":"Edited during lookup","author":"Owner author","kind":"other","cover_url":"https://publisher.example/owner.jpg","description":"Owner description","notes":"Owner note","tags":["owner"],"status":"done","visibility":"public","needs_review":false}`), 200)
	before := submissionMedia(t, s, id)
	close(release)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("deferred metadata lookup did not finish")
	}
	after := submissionMedia(t, s, id)
	if after.MetadataState != "ready" || after.MetadataWarning != "" {
		t.Fatalf("metadata completion not recorded: %+v", after)
	}
	before.MetadataState, before.UpdatedAt = "ready", after.UpdatedAt
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("metadata replaced concurrent owner fields: before=%+v after=%+v", before, after)
	}
}

func TestSubmissionEnrichmentPreservesExplicitFallbackTitleAndEmptyAuthor(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	submitter := submissionClient(t, owner)
	url := "https://publisher.example/explicit-title"
	title := fallbackTitle(url)
	body, err := json.Marshal(map[string]string{"url": url, "title": title, "author": ""})
	if err != nil {
		t.Fatal(err)
	}
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Publisher title</title><meta name="author" content="Publisher author"><meta name="description" content="Publisher description">`), nil
	})
	id := requireSubmissionReceipt(t, submitter.request("POST", "/api/integrations/items", string(body)), 201, "")
	// A new worker reloads the durable record; protection must survive a restart.
	NewWorker(s, f).enrichPending(context.Background())
	m := submissionMedia(t, s, id)
	if m.Title != title || m.Author != "" || m.Description != "Publisher description" || m.MetadataState != "ready" {
		t.Fatalf("enrichment overwrote explicit submission fields: %+v", m)
	}
	if body := owner.request("GET", "/api/media", "").Body.String(); strings.Contains(body, "title_explicit") || strings.Contains(body, "author_explicit") {
		t.Fatal("internal metadata intent leaked into the API")
	}

	url = "https://publisher.example/owner-correction"
	id = requireSubmissionReceipt(t, submitter.request("POST", "/api/integrations/items", `{"url":"`+url+`"}`), 201, "")
	title = fallbackTitle(url)
	body, err = json.Marshal(map[string]string{"title": title, "author": ""})
	if err != nil {
		t.Fatal(err)
	}
	// Even an unchanged-looking correction before claim is explicit owner intent.
	requireCode(t, owner.request("PATCH", "/api/media/"+id, string(body)), 200)
	NewWorker(s, f).enrichPending(context.Background())
	m = submissionMedia(t, s, id)
	if m.Title != title || m.Author != "" || m.Description != "Publisher description" {
		t.Fatalf("enrichment overwrote an owner correction before claim: %+v", m)
	}
}

func TestOwnerQuickSaveGeneratedTitleStillEnriches(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", `<title>Publisher title</title><meta name="author" content="Publisher author">`), nil
	})
	// The existing web Quick Save sends its generated hostname as Title.
	w := owner.request("POST", "/api/media", `{"url":"https://publisher.example/quick-save","title":"publisher.example","author":"","fetch_metadata":true}`)
	requireCode(t, w, 201)
	id := responseMap(t, w)["id"].(string)
	NewWorker(s, f).enrichPending(context.Background())
	m := submissionMedia(t, s, id)
	if m.Title != "Publisher title" || m.Author != "Publisher author" || m.MetadataState != "ready" {
		t.Fatalf("existing owner Quick Save stopped enriching: %+v", m)
	}
}

func TestSubmissionPublisherFailureRemainsAvailableAndRetryable(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	submitter := submissionClient(t, owner)
	available, calls := false, 0
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if !available {
			return fakeResponse(r, 503, "text/html", "Unavailable"), nil
		}
		return fakeResponse(r, 200, "text/html", `<title>Recovered title</title><meta name="author" content="Recovered author"><meta name="description" content="Recovered description">`), nil
	})
	id := requireSubmissionReceipt(t, submitter.request("POST", "/api/integrations/items", `{"url":"https://publisher.example/unavailable","notes":"Keep this note","tags":["retry"]}`), 201, "")
	if m := submissionMedia(t, s, id); calls != 0 || m.MetadataState != "pending" {
		t.Fatalf("publisher failure affected durable receipt: %+v calls=%d", m, calls)
	}
	// A fresh worker must find the persisted job without an in-memory trigger.
	NewWorker(s, f).enrichPending(context.Background())
	m := submissionMedia(t, s, id)
	if calls != 1 || m.MetadataState != "partial" || m.MetadataWarning == "" || m.Title == "" || m.Status != "pending" || m.Visibility != "private" || m.NeedsReview {
		t.Fatalf("failed publisher did not leave an editable incomplete item: %+v calls=%d", m, calls)
	}
	requireCode(t, owner.request("GET", "/api/media", ""), 200)
	available = true
	requireCode(t, owner.request("PATCH", "/api/media/"+id, `{"fetch_metadata":true}`), 200)
	NewWorker(s, f).enrichPending(context.Background())
	m = submissionMedia(t, s, id)
	if calls != 2 || m.MetadataState != "ready" || m.MetadataWarning != "" || m.Title != "Recovered title" || m.Author != "Recovered author" || m.Description != "Recovered description" || m.Notes != "Keep this note" || !reflect.DeepEqual(m.Tags, []string{"retry"}) {
		t.Fatalf("existing metadata retry failed: %+v calls=%d", m, calls)
	}
}

func TestSubmissionCommitFailureDoesNotReturnReceiptOrTriggerMetadata(t *testing.T) {
	s := integrationStore(t)
	owner, f := ownerClient(t, s)
	submitter := submissionClient(t, owner)
	worker := NewWorker(s, f)
	submitter.handler = (&Server{Store: s, Fetcher: f, Worker: worker}).Handler()
	calls := 0
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return fakeResponse(r, 200, "text/html", "<title>Publisher title</title>"), nil
	})
	// Reject at COMMIT, after insertMedia has returned a would-be created item.
	_, err := s.Pool.Exec(context.Background(), `CREATE FUNCTION reject_submission_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only commit failure'; END; $$;
CREATE CONSTRAINT TRIGGER reject_submission_commit AFTER INSERT ON media DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_submission_commit()`)
	if err != nil {
		t.Fatal(err)
	}
	w := submitter.request("POST", "/api/integrations/items", `{"url":"https://publisher.example/failed-commit"}`)
	requireCode(t, w, 500)
	if body := responseMap(t, w); len(body) != 1 || body["error"] == nil || calls != 0 {
		t.Fatalf("failed storage returned a receipt or fetched publisher: %s calls=%d", w.Body.String(), calls)
	}
	select {
	case <-worker.metadataTrigger:
		t.Fatal("failed commit woke the metadata worker")
	default:
	}
	items, err := s.ListMedia(context.Background())
	if err != nil || len(items) != 0 {
		t.Fatalf("failed submission committed media: %+v %v", items, err)
	}
	var seen int
	if err = s.Pool.QueryRow(context.Background(), "SELECT count(*) FROM seen_articles").Scan(&seen); err != nil || seen != 0 {
		t.Fatalf("failed submission committed duplicate history: %d %v", seen, err)
	}
}

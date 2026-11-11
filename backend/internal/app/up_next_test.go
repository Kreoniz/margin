package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type bootstrapMediaGate struct {
	entered, release chan struct{}
	once             sync.Once
}

func (g *bootstrapMediaGate) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "FROM media WHERE NOT is_demo ORDER BY") {
		g.once.Do(func() {
			close(g.entered)
			select {
			case <-g.release:
			case <-ctx.Done():
			}
		})
	}
	return ctx
}
func (*bootstrapMediaGate) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestUpNextBootstrapSnapshotDuringCompletionOrDeletion(t *testing.T) {
	for _, action := range []string{"done", "delete"} {
		t.Run(action, func(t *testing.T) {
			s := integrationStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			item := NewMedia()
			item.Title = "Chosen before concurrent " + action
			item, err := s.CreateMedia(ctx, item)
			if err != nil {
				t.Fatal(err)
			}
			version := int64(0)
			if _, err = s.changeUpNext(ctx, upNextInput{&version, item.ID, "add"}); err != nil {
				t.Fatal(err)
			}
			gate := &bootstrapMediaGate{entered: make(chan struct{}), release: make(chan struct{})}
			config := s.Pool.Config()
			config.ConnConfig.Tracer = gate
			pool, err := pgxpool.NewWithConfig(ctx, config)
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			server := &Server{Store: &Store{pool}}
			response := httptest.NewRecorder()
			finished := make(chan struct{})
			go func() {
				defer close(finished)
				server.bootstrap(response, httptest.NewRequest("GET", "/api/bootstrap", nil).WithContext(ctx))
			}()
			select {
			case <-gate.entered:
			case <-ctx.Done():
				t.Fatal("bootstrap never reached media read")
			}
			if action == "done" {
				done := "done"
				_, err = s.PatchMedia(ctx, item.ID, MediaInput{Status: &done})
			} else {
				err = s.DeleteMedia(ctx, item.ID)
			}
			close(gate.release)
			<-finished
			if err != nil {
				t.Fatal(err)
			}
			var body struct {
				UpNext UpNext  `json:"up_next"`
				Media  []Media `json:"media"`
			}
			if response.Code != 200 {
				t.Fatalf("bootstrap: %d %s", response.Code, response.Body)
			}
			if err = json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if len(body.UpNext.IDs) != 1 || len(body.Media) != 1 || body.Media[0].ID != body.UpNext.IDs[0] || body.Media[0].Status != "pending" {
				t.Fatalf("bootstrap mixed queue and media snapshots: %+v", body)
			}
			latest, err := s.UpNext(ctx)
			if err != nil || len(latest.IDs) != 0 {
				t.Fatalf("concurrent mutation did not commit: %+v %v", latest, err)
			}
		})
	}
}

func TestUpNextOrder(t *testing.T) {
	original := []string{"book", "video", "game"}
	for _, tc := range []struct {
		id, action string
		want       []string
		changed    bool
	}{
		{"game", "up", []string{"book", "game", "video"}, true},
		{"book", "down", []string{"video", "book", "game"}, true},
		{"book", "up", original, false},
		{"game", "down", original, false},
		{"video", "remove", []string{"book", "game"}, true},
		{"article", "add", []string{"book", "video", "game", "article"}, true},
		{"book", "add", original, false},
		{"missing", "remove", original, false},
	} {
		got, changed, err := reorderUpNext(original, tc.id, tc.action)
		if err != nil || changed != tc.changed || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s %s: %v %v %v", tc.action, tc.id, got, changed, err)
		}
	}
	if !reflect.DeepEqual(original, []string{"book", "video", "game"}) {
		t.Fatal("mutated input")
	}
	for _, action := range []string{"up", "down", "unknown"} {
		if _, _, err := reorderUpNext(original, "missing", action); err == nil {
			t.Fatalf("accepted %s", action)
		}
	}
}

func TestUpNextPersistenceStatusDeleteAndConflicts(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	q, err := s.UpNext(ctx)
	if err != nil || q.Version != 0 || len(q.IDs) != 0 {
		t.Fatalf("initial queue: %+v %v", q, err)
	}
	var items []Media
	for _, kind := range []string{"book", "video", "game"} {
		m := NewMedia()
		m.Title = "Chosen " + kind
		m.Kind = kind
		m, err = s.CreateMedia(ctx, m)
		if err != nil {
			t.Fatal(err)
		}
		items = append(items, m)
	}
	change := func(id, action string) {
		t.Helper()
		q, err = s.changeUpNext(ctx, upNextInput{&q.Version, id, action})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, m := range items {
		change(m.ID, "add")
	}
	change(items[2].ID, "up")
	want := []string{items[0].ID, items[2].ID, items[1].ID}
	// A fresh Store reads durable mixed order, independent of media creation time.
	stored, err := (&Store{s.Pool}).UpNext(ctx)
	if err != nil || !reflect.DeepEqual(stored.IDs, want) {
		t.Fatalf("persisted %+v %v", stored, err)
	}
	oldVersion := q.Version
	change(items[0].ID, "add")
	if q.Version != oldVersion {
		t.Fatal("idempotent add bumped version")
	}
	stale := oldVersion - 1
	latest, err := s.changeUpNext(ctx, upNextInput{&stale, items[0].ID, "down"})
	if !errors.Is(err, errUpNextConflict) || !reflect.DeepEqual(latest.IDs, want) {
		t.Fatalf("stale overwrite: %+v %v", latest, err)
	}
	if _, err = s.changeUpNext(ctx, upNextInput{nil, items[0].ID, "remove"}); err == nil {
		t.Fatal("missing precondition accepted")
	}
	done := "done"
	if _, err = s.PatchMedia(ctx, items[2].ID, MediaInput{Status: &done}); err != nil {
		t.Fatal(err)
	}
	q, _ = s.UpNext(ctx)
	if len(q.IDs) != 2 || q.Version != oldVersion+1 {
		t.Fatalf("done didn't remove %+v", q)
	}
	if _, err = s.changeUpNext(ctx, upNextInput{&q.Version, items[2].ID, "add"}); err == nil {
		t.Fatal("queued completed item")
	}
	pending := "pending"
	if _, err = s.PatchMedia(ctx, items[2].ID, MediaInput{Status: &pending}); err != nil {
		t.Fatal(err)
	}
	q, _ = s.UpNext(ctx)
	if len(q.IDs) != 2 {
		t.Fatal("undo reprioritized")
	}
	if err = s.DeleteMedia(ctx, items[0].ID); err != nil {
		t.Fatal(err)
	}
	q, _ = s.UpNext(ctx)
	if !reflect.DeepEqual(q.IDs, []string{items[1].ID}) || q.Version != oldVersion+2 {
		t.Fatalf("delete didn't remove %+v", q)
	}
	change(items[1].ID, "remove")
	if _, err = scanMedia(s.Pool.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE id=$1", items[1].ID)); err != nil {
		t.Fatal("queue removal deleted library item", err)
	}
}

func TestUpNextConcurrentChanges(t *testing.T) {
	s := integrationStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var ids []string
	for i := range 2 {
		m := NewMedia()
		m.Title = fmt.Sprint("Concurrent ", i)
		m, err := s.CreateMedia(ctx, m)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	var wg sync.WaitGroup
	outcomes := make(chan error, 2)
	for _, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v := int64(0)
			_, err := s.changeUpNext(ctx, upNextInput{&v, id, "add"})
			outcomes <- err
		}()
	}
	wg.Wait()
	close(outcomes)
	success, conflict := 0, 0
	for err := range outcomes {
		if err == nil {
			success++
		} else if errors.Is(err, errUpNextConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("lost update: %d %d", success, conflict)
	}
	q, _ := s.UpNext(ctx)
	// Completing and a stale add serialize safely; either way no completed member survives.
	wg.Add(2)
	go func() {
		defer wg.Done()
		done := "done"
		if _, err := s.PatchMedia(ctx, q.IDs[0], MediaInput{Status: &done}); err != nil {
			t.Error(err)
		}
	}()
	go func() {
		defer wg.Done()
		_, err := s.changeUpNext(ctx, upNextInput{&q.Version, q.IDs[0], "add"})
		if err != nil && !errors.Is(err, errUpNextConflict) {
			t.Error(err)
		}
	}()
	wg.Wait()
	q, _ = s.UpNext(ctx)
	if len(q.IDs) != 0 {
		t.Fatalf("completed member survived %+v", q)
	}
}

func TestUpNextOwnerPrivacyAndBrowserCompletion(t *testing.T) {
	s := integrationStore(t)
	c, _ := ownerClient(t, s)
	anon := &apiTestClient{t: t, handler: c.handler}
	requireCode(t, anon.request("GET", "/api/up-next", ""), 401)
	requireCode(t, anon.request("POST", "/api/up-next", `{}`), 401)
	w := c.request("POST", "/api/media", `{"title":"Private priority","url":"https://queue.example/item","visibility":"public"}`)
	requireCode(t, w, 201)
	id := responseMap(t, w)["id"].(string)
	body := fmt.Sprintf(`{"id":%q,"action":"add","expected_version":0}`, id)
	requireCode(t, c.request("POST", "/api/up-next", body), 200)
	w = c.request("POST", "/api/up-next", body)
	requireCode(t, w, 409)
	conflict := responseMap(t, w)
	if conflict["code"] != "up_next_conflict" || conflict["up_next"] == nil {
		t.Fatal(conflict)
	}
	for _, path := range []string{"/api/public/media", "/api/public/media/" + id, "/api/media"} {
		w = c.request("GET", path, "")
		requireCode(t, w, 200)
		if strings.Contains(w.Body.String(), "up_next") || strings.Contains(w.Body.String(), "position") {
			t.Fatal("priority leak", path)
		}
	}
	// Export retains its existing library scope, without queue state.
	export := c.request("GET", "/api/export", "")
	requireCode(t, export, 200)
	archive, err := zip.NewReader(bytes.NewReader(export.Body.Bytes()), int64(export.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range archive.File {
		if file.Name != "library.json" {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "up_next") || strings.Contains(string(data), `"position"`) {
			t.Fatal("export leaked priority")
		}
	}
	// Owner queue mutations retain same-origin CSRF checks.
	r := httptest.NewRequest("POST", "/api/up-next", strings.NewReader(body))
	r.AddCookie(c.cookie)
	r.Header.Set("Origin", "https://foreign.example")
	w = httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	requireCode(t, w, 403)
	browser := responseMap(t, c.request("POST", "/api/integration/browser-token", ""))["token"].(string)
	r = httptest.NewRequest("GET", "/api/up-next", nil)
	r.Header.Set("Authorization", "Bearer "+browser)
	w = httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	requireCode(t, w, 401)
	capture := func(action string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/integrations/capture", strings.NewReader(`{"url":"https://queue.example/item","action":"`+action+`"}`))
		r.Header.Set("Authorization", "Bearer "+browser)
		w := httptest.NewRecorder()
		c.handler.ServeHTTP(w, r)
		return w
	}
	requireCode(t, capture("save"), 200)
	q, _ := s.UpNext(context.Background())
	if len(q.IDs) != 1 || q.Version != 1 {
		t.Fatal("duplicate save changed priority", q)
	}
	w = capture("done")
	requireCode(t, w, 200)
	if strings.Contains(w.Body.String(), "up_next") {
		t.Fatal("receipt leaked queue")
	}
	q, _ = s.UpNext(context.Background())
	if len(q.IDs) != 0 || q.Version != 2 {
		t.Fatal("capture completion retained queue", q)
	}
	w = c.request("GET", "/api/bootstrap", "")
	requireCode(t, w, 200)
	var bootstrap struct {
		UpNext UpNext `json:"up_next"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &bootstrap); err != nil || bootstrap.UpNext.Version != 2 {
		t.Fatal("bootstrap", err, w.Body.String())
	}
}

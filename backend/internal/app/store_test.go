package app

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestIntegrationAnthropicAutoSavePublicationDates(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	src, err := s.CreateSource(ctx, Source{Name: "Anthropic", SiteURL: "https://www.anthropic.com/news", FeedURL: "https://www.anthropic.com/news", Parser: "html", IntervalMinutes: 60, AutoSave: true})
	if err != nil {
		t.Fatal(err)
	}
	var cutoff time.Time
	if err = s.Pool.QueryRow(ctx, "SELECT auto_save_after FROM sources WHERE id=$1", src.ID).Scan(&cutoff); err != nil {
		t.Fatal(err)
	}
	// Discovery is after the cutoff, so fallback timestamps alone would auto-save.
	discovered := cutoff.Add(time.Hour)
	future := cutoff.Add(2 * time.Hour).Truncate(time.Second)
	past := cutoff.Add(-24 * time.Hour).Truncate(time.Second)
	body := `<main><ul>
<li data-listing-row="1"><a href="/news/malformed-datetime"><h3>Malformed datetime</h3></a><time datetime="not-a-date">Earlier</time></li>
<li data-listing-row="2"><a href="/news/malformed-text"><h3>Malformed text</h3></a><time>not-a-date</time></li>
<li data-listing-row="3"><a href="/news/missing-date"><h3>Missing date</h3></a><time></time></li>
<li data-listing-row="4"><a href="/news/future"><h3>Known future</h3></a><time datetime="` + future.Format(time.RFC3339) + `"></time></li>
<li data-listing-row="5"><a href="/news/past"><h3>Known past</h3></a><time datetime="` + past.Format(time.RFC3339) + `"></time></li>
</ul></main>`
	items, err := ParseAnthropic([]byte(body), src.FeedURL, discovered)
	if err != nil || len(items) != 5 {
		t.Fatalf("Anthropic: %+v %v", items, err)
	}
	claimed, token, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil || claimed.ID != src.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	if err = s.FinishSource(ctx, claimed, token, items, nil); err != nil {
		t.Fatal(err)
	}
	media, err := s.ListMedia(ctx)
	if err != nil || len(media) != 1 || media[0].URL != "https://www.anthropic.com/news/future" || media[0].Status != "pending" || media[0].Visibility != "private" {
		t.Fatalf("only known future news should auto-save: %+v %v", media, err)
	}
	inbox, err := s.ListInbox(ctx, true)
	if err != nil || len(inbox) != len(items) {
		t.Fatalf("inbox: %+v %v", inbox, err)
	}
	for _, item := range inbox {
		wantState := "new"
		wantPublished := discovered
		switch item.Title {
		case "Known future":
			wantState, wantPublished = "saved", future
		case "Known past":
			wantPublished = past
		}
		if item.State != wantState || !item.PublishedAt.Equal(wantPublished) {
			t.Errorf("%s: state=%s published=%s, want state=%s published=%s", item.Title, item.State, item.PublishedAt, wantState, wantPublished)
		}
	}
}

func TestIntegrationDeleteMediaResetsOnlyLinkedInbox(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	_, err := s.CreateSource(ctx, Source{Name: "Publisher", SiteURL: "https://example.com/", FeedURL: "https://example.com/feed", Parser: "rss", IntervalMinutes: 60})
	if err != nil {
		t.Fatal(err)
	}
	src, token, err := s.ClaimSource(ctx, false, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	entries := []InboxItem{}
	for _, name := range []string{"first", "second", "unrelated", "new", "read", "dismissed"} {
		entries = append(entries, InboxItem{Title: name, URL: "https://example.com/" + name, PublishedAt: time.Now().UTC()})
	}
	if err = s.FinishSource(ctx, src, token, entries, nil); err != nil {
		t.Fatal(err)
	}
	inbox, err := s.ListInbox(ctx, true)
	if err != nil || len(inbox) != len(entries) {
		t.Fatalf("inbox: %+v %v", inbox, err)
	}
	ids := map[string]string{}
	for _, item := range inbox {
		ids[item.Title] = item.ID
	}
	m, created, err := s.SaveInbox(ctx, ids["first"])
	if err != nil || !created {
		t.Fatalf("first save: %+v %v %v", m, created, err)
	}
	// Two inbox entries can link to one library record after its URL is edited.
	if _, err = s.PatchMedia(ctx, m.ID, MediaInput{URL: ptr("https://example.com/second")}); err != nil {
		t.Fatal(err)
	}
	second, created, err := s.SaveInbox(ctx, ids["second"])
	if err != nil || created || second.ID != m.ID {
		t.Fatalf("second link: %+v %v %v", second, created, err)
	}
	unrelated, _, err := s.SaveInbox(ctx, ids["unrelated"])
	if err != nil {
		t.Fatal(err)
	}
	for name, state := range map[string]string{"second": "dismissed", "read": "read", "dismissed": "dismissed"} {
		if _, err = s.PatchInbox(ctx, ids[name], state); err != nil {
			t.Fatal(err)
		}
	}
	assertInbox := func(states map[string]string, linkedID string) {
		t.Helper()
		items, err := s.ListInbox(ctx, true)
		if err != nil || len(items) != len(entries) {
			t.Fatalf("inbox after delete: %+v %v", items, err)
		}
		for _, item := range items {
			if item.State != states[item.Title] {
				t.Errorf("%s state=%q, want %q", item.Title, item.State, states[item.Title])
			}
			var mediaID string
			if err := s.Pool.QueryRow(ctx, "SELECT COALESCE(media_id::text,'') FROM inbox WHERE id=$1", item.ID).Scan(&mediaID); err != nil {
				t.Fatal(err)
			}
			want := linkedID
			switch item.Title {
			case "unrelated":
				want = unrelated.ID
			case "new", "read", "dismissed":
				want = ""
			}
			if mediaID != want {
				t.Errorf("%s media_id=%q, want %q", item.Title, mediaID, want)
			}
		}
	}
	// Force DELETE to fail after the inbox update, proving both roll back together.
	if _, err = s.Pool.Exec(ctx, "CREATE TABLE media_delete_guard (media_id uuid REFERENCES media(id))"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, "INSERT INTO media_delete_guard VALUES ($1)", m.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteMedia(ctx, m.ID); err == nil {
		t.Fatal("delete ignored the test foreign key")
	}
	assertInbox(map[string]string{"first": "saved", "second": "dismissed", "unrelated": "saved", "new": "new", "read": "read", "dismissed": "dismissed"}, m.ID)
	if _, err = s.Pool.Exec(ctx, "DROP TABLE media_delete_guard"); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteMedia(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	assertInbox(map[string]string{"first": "read", "second": "read", "unrelated": "saved", "new": "new", "read": "read", "dismissed": "dismissed"}, "")
	visible, err := s.ListInbox(ctx, false)
	if err != nil || len(visible) != 4 {
		t.Fatalf("deleted links did not return to the inbox: %+v %v", visible, err)
	}
	if err = s.DeleteMedia(ctx, m.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("repeat delete: %v", err)
	}
	resaved, created, err := s.SaveInbox(ctx, ids["first"])
	if err != nil || !created || resaved.ID == m.ID {
		t.Fatalf("resave after delete: %+v %v %v", resaved, created, err)
	}
	again, created, err := s.SaveInbox(ctx, ids["first"])
	if err != nil || created || again.ID != resaved.ID {
		t.Fatalf("idempotent resave: %+v %v %v", again, created, err)
	}
	media, err := s.ListMedia(ctx)
	if err != nil || len(media) != 2 {
		t.Fatalf("unrelated media or resaved item lost: %+v %v", media, err)
	}
}

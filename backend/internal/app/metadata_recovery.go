package app

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
)

type publisherFeedEntry struct {
	items map[string]Metadata
	at    time.Time
}
type publisherFeedCache struct {
	sync.Mutex
	entries map[string]publisherFeedEntry
}

// Look up the requested URL in a known first-party feed, independently of the
// inbox's recent-item retention. Never search a third-party mirror or guess data.
func (f *Fetcher) publisherMetadata(ctx context.Context, raw string) (Metadata, bool) {
	target, _ := url.Parse(raw)
	if target == nil {
		return Metadata{}, false
	}
	for _, source := range DefaultSources() {
		site, _ := url.Parse(source.SiteURL)
		if source.Parser != "rss" || site == nil || strings.TrimPrefix(site.Hostname(), "www.") != strings.TrimPrefix(target.Hostname(), "www.") {
			continue
		}
		f.metadataFeeds.Lock()
		defer f.metadataFeeds.Unlock()
		cached, ok := f.metadataFeeds.entries[source.FeedURL]
		if !ok || time.Since(cached.at) > 10*time.Minute {
			lookup, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
			result, err := f.Get(lookup, source.FeedURL, 8<<20)
			if err != nil {
				return Metadata{}, false
			}
			feed, err := gofeed.NewParser().ParseString(string(result.Body))
			if err != nil {
				return Metadata{}, false
			}
			cached = publisherFeedEntry{items: map[string]Metadata{}, at: time.Now()}
			for index, item := range feed.Items {
				if index >= 5000 {
					break
				}
				link := safeLink(result.URL, item.Link)
				if link == "" || strings.TrimSpace(item.Title) == "" {
					continue
				}
				author := ""
				if item.Author != nil {
					author = plain(item.Author.Name)
				}
				cover := ""
				if item.Image != nil {
					cover = safeLink(result.URL, item.Image.URL)
				}
				for _, enclosure := range item.Enclosures {
					if cover == "" && strings.HasPrefix(enclosure.Type, "image/") {
						cover = safeLink(result.URL, enclosure.URL)
					}
				}
				cached.items[urlKey(link)] = Metadata{Title: clip(plain(item.Title), 1000), Author: clip(author, 1000), Kind: "article", URL: raw, CoverURL: cover, Description: clip(plain(first(item.Description, item.Content)), 20000)}
			}
			if f.metadataFeeds.entries == nil {
				f.metadataFeeds.entries = map[string]publisherFeedEntry{}
			}
			f.metadataFeeds.entries[source.FeedURL] = cached
		}
		m, found := cached.items[urlKey(raw)]
		if found {
			m.URL = raw
			if m.CoverURL == "" {
				m.Warning = "Title and description recovered from the publisher's feed. A preview image wasn't available."
			}
			return m, true
		}
	}
	return Metadata{}, false
}

func generatedTitle(m Media) bool {
	parsed, _ := url.Parse(m.URL)
	return m.Title == fallbackTitle(m.URL) || m.Title == m.URL || parsed != nil && m.Title == parsed.Hostname()
}

func (w *Worker) TriggerMetadata() {
	select {
	case w.metadataTrigger <- struct{}{}:
	default:
	}
}
func (w *Worker) runMetadata(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		w.enrichPending(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-w.metadataTrigger:
		}
	}
}
func (w *Worker) enrichPending(ctx context.Context) {
	for range 20 {
		if ctx.Err() != nil {
			return
		}
		token := newID()
		before, err := scanMedia(w.store.Pool.QueryRow(ctx, `UPDATE media SET metadata_lease_token=$1,metadata_lease_until=now()+interval '45 seconds'
 WHERE id=(SELECT id FROM media WHERE NOT is_demo AND metadata_state='pending' AND (metadata_lease_until IS NULL OR metadata_lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING `+mediaColumns, token))
		if errors.Is(err, ErrNotFound) {
			return
		}
		if err != nil {
			return
		}
		lookup, cancel := context.WithTimeout(ctx, 32*time.Second)
		metadata, fetchErr := w.fetcher.Metadata(lookup, before.URL)
		cancel()
		if ctx.Err() != nil {
			return
		}
		if fetchErr != nil {
			metadata.Warning = "Details could not be fetched. Retry from the item editor."
		}
		_ = w.store.finishMetadata(ctx, before, token, metadata)
	}
}

func (s *Store) finishMetadata(ctx context.Context, before Media, token string, metadata Metadata) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	current, err := scanMedia(tx.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE id=$1 AND NOT is_demo AND metadata_state='pending' AND metadata_lease_token=$2 AND url=$3 FOR UPDATE", before.ID, token, before.URL))
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	in := MediaInput{}
	if current.Title == before.Title && generatedTitle(before) && metadata.Title != "" {
		in.Title = &metadata.Title
	}
	if before.Author == "" && current.Author == "" && metadata.Author != "" {
		in.Author = &metadata.Author
	}
	if before.CoverURL == "" && current.CoverURL == "" && metadata.CoverURL != "" {
		in.CoverURL = &metadata.CoverURL
	}
	if before.Description == "" && current.Description == "" && metadata.Description != "" {
		in.Description = &metadata.Description
	}
	if current.Kind == before.Kind && oneOf(current.Kind, "article", "other") && metadata.Kind != "" {
		in.Kind = &metadata.Kind
	}
	current, err = in.Apply(current)
	if err != nil {
		return err
	}
	state := "ready"
	if metadata.Warning != "" {
		state = "partial"
	}
	_, err = tx.Exec(ctx, `UPDATE media SET title=$2,author=$3,kind=$4,cover_url=$5,description=$6,metadata_state=$7,metadata_warning=$8,metadata_lease_token=NULL,metadata_lease_until=NULL,updated_at=now() WHERE id=$1`, current.ID, current.Title, current.Author, current.Kind, current.CoverURL, current.Description, state, clip(metadata.Warning, 1000))
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

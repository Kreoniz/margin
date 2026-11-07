package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var youtubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func youtubeID(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	id := ""
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if host == "youtu.be" && len(parts) == 1 {
		id = parts[0]
	}
	if oneOf(host, "youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com") {
		if u.Path == "/watch" {
			id = u.Query().Get("v")
		}
		if len(parts) == 2 && oneOf(parts[0], "shorts", "embed", "live") {
			id = parts[1]
		}
	}
	if youtubeIDPattern.MatchString(id) {
		return id
	}
	return ""
}

// Prefer YouTube's first-party oEmbed metadata over its script/consent-heavy
// watch HTML. Never use the returned embed HTML or a third-party mirror.
func (f *Fetcher) youtubeMetadata(ctx context.Context, raw, id string) (Metadata, bool) {
	params := url.Values{"url": {"https://www.youtube.com/watch?v=" + id}, "format": {"json"}}
	var result FetchResult
	for attempt := 0; attempt < 2; attempt++ {
		if ctx.Err() != nil {
			return Metadata{}, false
		}
		lookup, cancel := context.WithTimeout(ctx, 5*time.Second)
		var err error
		result, err = f.Get(lookup, "https://www.youtube.com/oembed?"+params.Encode(), 128<<10)
		cancel()
		if err == nil {
			break
		}
		// Public video metadata can intermittently fail during TLS or response
		// reads. Retry one idempotent request, with a fresh bounded budget. HTTP
		// refusals, invalid responses and certificate failures are not retried.
		var networkError net.Error
		transient := errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &networkError) && networkError.Timeout()
		if attempt == 1 || !transient || ctx.Err() != nil {
			return Metadata{}, false
		}
	}
	var data struct {
		Title     string `json:"title"`
		Author    string `json:"author_name"`
		Thumbnail string `json:"thumbnail_url"`
		Type      string `json:"type"`
	}
	if json.Unmarshal(result.Body, &data) != nil || strings.TrimSpace(data.Title) == "" || data.Type != "video" {
		return Metadata{}, false
	}
	cover := safeLink(result.URL, data.Thumbnail)
	m := Metadata{Title: clip(plain(data.Title), 1000), Author: clip(plain(data.Author), 1000), Kind: "video", URL: raw, CoverURL: cover}
	if cover == "" {
		m.Warning = "YouTube shared the video title, but no preview image. You can add one manually."
	}
	return m, true
}

func youtubePlaceholder(title string) bool {
	title = strings.ToLower(strings.TrimSpace(title))
	return title == "youtube" || title == "- youtube" || title == "watch" || title == "" || strings.Contains(title, "before you continue") || strings.Contains(title, "consent.youtube") || strings.Contains(title, "sign in to confirm")
}

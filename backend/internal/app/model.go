package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

type Media struct {
	SelectedText          string     `json:"selected_text,omitempty"`
	SelectedTextSourceURL string     `json:"selected_text_source_url,omitempty"`
	TitleExplicit         bool       `json:"-"`
	AuthorExplicit        bool       `json:"-"`
	AutoAdded             bool       `json:"auto_added"`
	KindExplicit          bool       `json:"kind_explicit"`
	MetadataState         string     `json:"metadata_state,omitempty"`
	MetadataWarning       string     `json:"metadata_warning,omitempty"`
	NeedsReview           bool       `json:"needs_review"`
	ID                    string     `json:"id"`
	Title                 string     `json:"title"`
	Author                string     `json:"author"`
	Kind                  string     `json:"kind"`
	Status                string     `json:"status"`
	URL                   string     `json:"url"`
	CoverURL              string     `json:"cover_url"`
	Description           string     `json:"description"`
	Notes                 string     `json:"notes"`
	Tags                  []string   `json:"tags"`
	Visibility            string     `json:"visibility"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
}

// PublicMedia is an explicit allowlist: owner notes and operational data never serialize.
type PublicMedia struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Author      string     `json:"author"`
	Kind        string     `json:"kind"`
	Status      string     `json:"status"`
	URL         string     `json:"url"`
	CoverURL    string     `json:"cover_url"`
	Description string     `json:"description"`
	Tags        []string   `json:"tags"`
	Visibility  string     `json:"visibility"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

func publicMedia(m Media) PublicMedia {
	return PublicMedia{m.ID, m.Title, m.Author, m.Kind, m.Status, m.URL, m.CoverURL, m.Description, m.Tags, m.Visibility, m.CreatedAt, m.UpdatedAt, m.CompletedAt}
}

type MediaInput struct {
	InferKind       bool      `json:"infer_kind,omitempty"`
	Expected        *Media    `json:"expected,omitempty"`
	ExpectedURL     *string   `json:"expected_url,omitempty"`
	FetchMetadata   bool      `json:"fetch_metadata,omitempty"`
	MetadataWarning *string   `json:"metadata_warning,omitempty"`
	NeedsReview     *bool     `json:"needs_review"`
	Title           *string   `json:"title"`
	Author          *string   `json:"author"`
	Kind            *string   `json:"kind"`
	Status          *string   `json:"status"`
	URL             *string   `json:"url"`
	CoverURL        *string   `json:"cover_url"`
	Description     *string   `json:"description"`
	Notes           *string   `json:"notes"`
	Tags            *[]string `json:"tags"`
	Visibility      *string   `json:"visibility"`
}

// Compare only submitted fields: unrelated edits can coexist, while a stale
// edit of the same field must be reconciled rather than silently replacing it.
func (in MediaInput) checkExpected(current Media) error {
	if in.ExpectedURL != nil && *in.ExpectedURL != current.URL {
		return ErrEditConflict
	}
	if in.Expected == nil {
		return nil
	}
	e := in.Expected
	if in.Kind != nil && current.KindExplicit != e.KindExplicit {
		return ErrEditConflict
	}
	for _, field := range []struct {
		submitted         *string
		current, expected string
	}{
		{in.Title, current.Title, e.Title}, {in.Author, current.Author, e.Author},
		{in.Kind, current.Kind, e.Kind}, {in.Status, current.Status, e.Status},
		{in.URL, current.URL, e.URL}, {in.CoverURL, current.CoverURL, e.CoverURL},
		{in.Description, current.Description, e.Description}, {in.Notes, current.Notes, e.Notes},
		{in.Visibility, current.Visibility, e.Visibility},
	} {
		if field.submitted != nil && field.current != field.expected {
			return ErrEditConflict
		}
	}
	if in.Tags != nil && !slices.Equal(current.Tags, e.Tags) || in.NeedsReview != nil && current.NeedsReview != e.NeedsReview {
		return ErrEditConflict
	}
	return nil
}

func NewMedia() Media {
	return Media{Kind: "other", Status: "pending", Visibility: "private", Tags: []string{}}
}

func (in MediaInput) Apply(m Media) (Media, error) {
	if in.Kind != nil {
		m.KindExplicit = !in.InferKind
	}
	if in.MetadataWarning != nil {
		m.MetadataWarning = clip(strings.TrimSpace(*in.MetadataWarning), 1000)
		if m.MetadataWarning != "" {
			m.MetadataState = "partial"
		} else if m.URL != "" {
			m.MetadataState = "ready"
		}
	}
	if in.FetchMetadata {
		m.MetadataState = "pending"
		m.MetadataWarning = ""
	}
	if in.NeedsReview != nil {
		m.NeedsReview = *in.NeedsReview
	}
	for _, p := range []struct {
		dst *string
		src *string
	}{{&m.Title, in.Title}, {&m.Author, in.Author}, {&m.Kind, in.Kind}, {&m.Status, in.Status}, {&m.URL, in.URL}, {&m.CoverURL, in.CoverURL}, {&m.Description, in.Description}, {&m.Notes, in.Notes}, {&m.Visibility, in.Visibility}} {
		if p.src != nil {
			*p.dst = strings.TrimSpace(*p.src)
		}
	}
	if in.Tags != nil {
		m.Tags = append([]string{}, (*in.Tags)...)
	}
	if m.Title == "" || len(m.Title) > 1000 {
		return m, errors.New("title is required and must be at most 1000 bytes")
	}
	if !oneOf(m.Kind, "book", "article", "paper", "video", "movie", "anime", "manga", "game", "other") {
		return m, errors.New("invalid kind")
	}
	if !oneOf(m.Status, "pending", "done") {
		return m, errors.New("invalid status")
	}
	if !oneOf(m.Visibility, "private", "public") {
		return m, errors.New("invalid visibility")
	}
	if len(m.Author) > 1000 || len(m.Description) > 20000 || len(m.Notes) > 100000 {
		return m, errors.New("text field is too long")
	}
	if len(m.Tags) > 50 {
		return m, errors.New("at most 50 tags are allowed")
	}
	tags := []string{}
	seen := map[string]bool{}
	for _, tag := range m.Tags {
		tag = strings.TrimSpace(tag)
		if len(tag) > 100 {
			return m, errors.New("tags must be at most 100 bytes")
		}
		if tag != "" && !seen[strings.ToLower(tag)] {
			tags = append(tags, tag)
			seen[strings.ToLower(tag)] = true
		}
	}
	m.Tags = tags
	var err error
	if m.URL != "" {
		m.URL, err = CanonicalURL(m.URL)
		if err != nil {
			return m, fmt.Errorf("url: %w", err)
		}
	}
	if m.CoverURL != "" && !isImagePath(m.CoverURL) {
		m.CoverURL, err = CanonicalURL(m.CoverURL)
		if err != nil {
			return m, fmt.Errorf("cover_url: %w", err)
		}
	} else if isImagePath(m.CoverURL) {
		m.CoverURL = strings.ToLower(m.CoverURL)
	}
	if m.Status == "done" {
		if m.CompletedAt == nil {
			now := time.Now().UTC()
			m.CompletedAt = &now
		}
	} else if in.Status != nil {
		m.CompletedAt = nil
	}

	if m.URL == "" && !(m.Kind == "book" && validISBN(m.Title) != "") {
		m.MetadataState = ""
		m.MetadataWarning = ""
	} else if m.MetadataState == "" {
		m.MetadataState = "ready"
	}
	return m, nil
}

type InboxItem struct {
	PublishedUnknown bool      `json:"-"`
	ID               string    `json:"id"`
	SourceID         string    `json:"source_id"`
	SourceName       string    `json:"source_name"`
	Title            string    `json:"title"`
	Author           string    `json:"author"`
	URL              string    `json:"url"`
	CoverURL         string    `json:"cover_url"`
	Description      string    `json:"description"`
	PublishedAt      time.Time `json:"published_at"`
	DiscoveredAt     time.Time `json:"discovered_at"`
	State            string    `json:"state"`
}

type Source struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	SiteURL         string     `json:"site_url"`
	FeedURL         string     `json:"feed_url"`
	Parser          string     `json:"parser"`
	AutoSave        bool       `json:"auto_save"`
	Enabled         bool       `json:"enabled"`
	IntervalMinutes int        `json:"interval_minutes"`
	LastSync        *time.Time `json:"last_sync"`
	NextSync        *time.Time `json:"next_sync"`
	LastError       string     `json:"last_error"`
	ItemCount       int        `json:"item_count"`
}

type SourcePatch struct {
	Name            *string `json:"name"`
	AutoSave        *bool   `json:"auto_save"`
	Enabled         *bool   `json:"enabled"`
	IntervalMinutes *int    `json:"interval_minutes"`
}

func oneOf(s string, values ...string) bool {
	for _, v := range values {
		if s == v {
			return true
		}
	}
	return false
}
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func hash(s string) string { b := sha256.Sum256([]byte(s)); return hex.EncodeToString(b[:]) }
func manualKey(m Media) string {
	normalize := func(s string) string { return strings.ToLower(strings.Join(strings.Fields(norm.NFC.String(s)), " ")) }
	return hash(normalize(m.Title) + "\x00" + normalize(m.Author) + "\x00" + m.Kind)
}
func validID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

var ErrNotFound = errors.New("not found")
var ErrEditConflict = errors.New("This item changed elsewhere. Your draft is still here; reload the latest item before saving these changes.")

type DuplicateError struct{ ExistingID string }

func (e *DuplicateError) Error() string { return "This item is already in your library" }

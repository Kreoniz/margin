package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) ListSamples(ctx context.Context) ([]Media, error) {
	return s.listMediaWhere(ctx, "is_demo")
}
func (s *Store) listMediaWhere(ctx context.Context, where string) ([]Media, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+mediaColumns+" FROM media WHERE "+where+" ORDER BY created_at DESC,id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Media{}
	for rows.Next() {
		m, err := scanMedia(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (s *Store) SampleCount(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM media WHERE is_demo").Scan(&n)
	return n, err
}
func (s *Store) DeleteSamples(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Lock positively identified samples before releasing any links.
	rows, err := tx.Query(ctx, "SELECT id FROM media WHERE is_demo FOR UPDATE")
	if err != nil {
		return err
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE inbox SET state='read',media_id=NULL WHERE media_id IN (SELECT id FROM media WHERE is_demo)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM media WHERE is_demo"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Server) publicList(w http.ResponseWriter, r *http.Request) {
	items, err := s.Store.listMediaWhere(r.Context(), "visibility='public' AND NOT is_demo")
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	out := []PublicMedia{}
	for _, m := range items {
		out = append(out, publicMedia(m))
	}
	writeJSON(w, 200, out)
}
func (s *Server) publicItem(w http.ResponseWriter, r *http.Request) {
	if !validID(r.PathValue("id")) {
		respond(w, 404, nil, ErrNotFound)
		return
	}
	m, err := scanMedia(s.Store.Pool.QueryRow(r.Context(), "SELECT "+mediaColumns+" FROM media WHERE id=$1 AND visibility='public' AND NOT is_demo", r.PathValue("id")))
	respond(w, 200, publicMedia(m), err)
}

type tokenState struct {
	Configured bool       `json:"configured"`
	CreatedAt  *time.Time `json:"created_at"`
}

func (s *Server) tokenStatus(w http.ResponseWriter, r *http.Request) {
	var stamp time.Time
	err := s.Store.Pool.QueryRow(r.Context(), "SELECT created_at FROM integration_token WHERE singleton").Scan(&stamp)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 200, tokenState{})
		return
	}
	respond(w, 200, tokenState{true, &stamp}, err)
}
func (s *Server) rotateToken(w http.ResponseWriter, r *http.Request) {
	token := randomSecret()
	var stamp time.Time
	err := s.Store.Pool.QueryRow(r.Context(), "INSERT INTO integration_token(token_hash) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET token_hash=EXCLUDED.token_hash,created_at=clock_timestamp() RETURNING created_at", hash(token)).Scan(&stamp)
	respond(w, 200, struct {
		Token     string    `json:"token"`
		CreatedAt time.Time `json:"created_at"`
	}{token, stamp}, err)
}
func (s *Server) revokeToken(w http.ResponseWriter, r *http.Request) {
	_, err := s.Store.Pool.Exec(r.Context(), "DELETE FROM integration_token")
	respond(w, 204, nil, err)
}
func bearerToken(r *http.Request) string {
	fields := strings.Fields(r.Header.Get("Authorization"))
	if len(fields) == 2 && strings.EqualFold(fields[0], "Bearer") && len(fields[1]) == 43 {
		return fields[1]
	}
	return ""
}
func (s *Store) validSubmissionToken(ctx context.Context, token string) (bool, error) {
	if token == "" {
		return false, nil
	}
	var ok bool
	err := s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM integration_token WHERE token_hash=$1)", hash(token)).Scan(&ok)
	return ok, err
}
func (s *Store) submit(ctx context.Context, token string, m Media) (Media, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return m, false, err
	}
	defer tx.Rollback(ctx)
	// Recheck under a lock after metadata fetching: rotation/revocation takes effect
	// before any subsequent submission transaction can create an item.
	var encoded string
	err = tx.QueryRow(ctx, "SELECT token_hash FROM integration_token WHERE token_hash=$1 FOR SHARE", hash(token)).Scan(&encoded)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, false, errCredentials
	}
	if err != nil {
		return m, false, err
	}
	m, created, err := insertMedia(ctx, tx, m)
	if err != nil {
		return m, false, err
	}
	return m, created, tx.Commit(ctx)
}
func (s *Server) prepareMedia(ctx context.Context, in MediaInput) (Media, error) {
	m := NewMedia()
	if in.FetchMetadata && in.URL != nil {
		canonical, err := CanonicalURL(*in.URL)
		if err != nil {
			return m, &ValidationError{err.Error()}
		}
		m.URL = canonical
		m.Title = fallbackTitle(canonical)
		m.Kind = "article"
		return in.Apply(m)
	}
	if in.URL != nil && strings.TrimSpace(*in.URL) != "" && !(in.Title != nil && in.Author != nil && in.Kind != nil && in.CoverURL != nil && in.Description != nil) {
		metadata, err := s.Fetcher.Metadata(ctx, *in.URL)
		if err != nil {
			return m, err
		}
		m.Title = metadata.Title
		m.Author = metadata.Author
		m.Kind = metadata.Kind
		m.URL = metadata.URL
		m.CoverURL = metadata.CoverURL
		m.Description = metadata.Description
		m.MetadataWarning = metadata.Warning
		m.MetadataState = "ready"
		if metadata.Warning != "" {
			m.MetadataState = "partial"
		}
		// Preserve the submitted canonical URL for stable duplicate matching across
		// redirects/canonical metadata changes. Explicit fields always win.
	}
	m, err := in.Apply(m)
	if err != nil {
		return m, &ValidationError{err.Error()}
	}
	return m, nil
}
func (s *Server) submitItem(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	ok, err := s.Store.validSubmissionToken(r.Context(), token)
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "Submission token required"})
		return
	}
	var in struct {
		Title  *string   `json:"title"`
		URL    *string   `json:"url"`
		Author *string   `json:"author"`
		Kind   *string   `json:"kind"`
		Tags   *[]string `json:"tags"`
		Notes  *string   `json:"notes"`
	}
	if !decode(w, r, &in) {
		return
	}
	m, err := s.prepareMedia(r.Context(), MediaInput{Title: in.Title, URL: in.URL, Author: in.Author, Kind: in.Kind, Tags: in.Tags, Notes: in.Notes})
	if err != nil {
		respond(w, 201, nil, err)
		return
	}
	m.NeedsReview = true
	m, created, err := s.Store.submit(r.Context(), token, m)
	if errors.Is(err, errCredentials) {
		writeJSON(w, 401, map[string]string{"error": "Submission token required"})
		return
	}
	status := 200
	if created {
		status = 201
	}
	respond(w, status, struct {
		ID      string `json:"id"`
		Created bool   `json:"created"`
	}{m.ID, created}, err)
}

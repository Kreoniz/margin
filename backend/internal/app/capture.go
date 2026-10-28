package app

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) browserTokenStatus(w http.ResponseWriter, r *http.Request) {
	var stamp time.Time
	err := s.Store.Pool.QueryRow(r.Context(), "SELECT created_at FROM browser_token WHERE singleton").Scan(&stamp)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 200, tokenState{})
		return
	}
	respond(w, 200, tokenState{true, &stamp}, err)
}
func (s *Server) rotateBrowserToken(w http.ResponseWriter, r *http.Request) {
	token := randomSecret()
	_, err := s.Store.Pool.Exec(r.Context(), "INSERT INTO browser_token(token_hash) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET token_hash=EXCLUDED.token_hash,created_at=clock_timestamp()", hash(token))
	respond(w, 200, map[string]string{"token": token}, err)
}
func (s *Server) revokeBrowserToken(w http.ResponseWriter, r *http.Request) {
	_, err := s.Store.Pool.Exec(r.Context(), "DELETE FROM browser_token")
	respond(w, 204, nil, err)
}
func (s *Server) captureItem(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	var ok bool
	err := s.Store.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM browser_token WHERE token_hash=$1)", hash(token)).Scan(&ok)
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "Browser capture token required"})
		return
	}
	var in struct {
		URL          string `json:"url"`
		Action       string `json:"action"`
		PageMetadata *struct {
			Title       string `json:"title"`
			Author      string `json:"author"`
			CoverURL    string `json:"cover_url"`
			Description string `json:"description"`
		} `json:"page_metadata,omitempty"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !oneOf(in.Action, "save", "done") {
		writeJSON(w, 400, map[string]string{"error": "Action must be save or done"})
		return
	}
	canonical, err := CanonicalURL(in.URL)
	if err != nil {
		respond(w, 400, nil, &ValidationError{err.Error()})
		return
	}
	// Resolve duplicates before fetching, so Done works even while a publisher is down.
	var exists bool
	err = s.Store.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM media WHERE NOT is_demo AND url_key=$1)", urlKey(canonical)).Scan(&exists)
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	m := NewMedia()
	if !exists {
		m, err = s.prepareMedia(r.Context(), MediaInput{URL: &canonical})
		if err != nil {
			respond(w, 400, nil, err)
			return
		}
		if in.PageMetadata != nil {
			hint := in.PageMetadata
			hint.Title = clip(strings.TrimSpace(hint.Title), 1000)
			hint.Author = clip(strings.TrimSpace(hint.Author), 1000)
			hint.Description = clip(strings.TrimSpace(hint.Description), 20000)
			patch := MediaInput{}
			if hint.Title != "" && generatedTitle(m) {
				patch.Title = &hint.Title
			}
			if m.Author == "" && hint.Author != "" {
				patch.Author = &hint.Author
			}
			if m.CoverURL == "" && hint.CoverURL != "" {
				if cover, e := CanonicalURL(hint.CoverURL); e == nil {
					patch.CoverURL = &cover
				}
			}
			if m.Description == "" && hint.Description != "" {
				patch.Description = &hint.Description
			}
			if enriched, e := patch.Apply(m); e == nil {
				m = enriched
				if !generatedTitle(m) && (m.CoverURL != "" || m.Description != "") {
					m.MetadataWarning = ""
					m.MetadataState = "ready"
				}
			}
		}
		m.NeedsReview = true
	}
	tx, err := s.Store.Pool.Begin(r.Context())
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	defer tx.Rollback(r.Context())
	var locked string
	err = tx.QueryRow(r.Context(), "SELECT token_hash FROM browser_token WHERE token_hash=$1 FOR SHARE", hash(token)).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 401, map[string]string{"error": "Browser capture token required"})
		return
	}
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	// Serialize same-URL captures (including creation versus completion) across tabs.
	_, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", urlKey(canonical))
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	current, err := scanMedia(tx.QueryRow(r.Context(), "SELECT "+mediaColumns+" FROM media WHERE NOT is_demo AND url_key=$1 FOR UPDATE", urlKey(canonical)))
	created := false
	if errors.Is(err, ErrNotFound) {
		if exists {
			respond(w, 404, nil, ErrNotFound)
			return
		}
		m.URL = canonical
		current, created, err = insertMedia(r.Context(), tx, m)
	}
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	if in.Action == "done" {
		_, err = tx.Exec(r.Context(), "UPDATE media SET status='done',completed_at=COALESCE(completed_at,now()),updated_at=now() WHERE id=$1", current.ID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	status := 200
	if created {
		status = 201
	}
	warning := ""
	if created && current.MetadataWarning != "" {
		warning = "Some details are unavailable. Open Margin to retry or edit them."
	}
	respond(w, status, struct {
		ID      string `json:"id"`
		Created bool   `json:"created"`
		Action  string `json:"action"`
		Warning string `json:"warning,omitempty"`
	}{current.ID, created, strings.ToLower(in.Action), warning}, err)
}

package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type inboxCursor struct {
	Published time.Time `json:"published"`
	ID        string    `json:"id"`
}
type InboxPage struct {
	Items      []InboxItem `json:"items"`
	NextCursor string      `json:"next_cursor,omitempty"`
	Total      int         `json:"total"`
}

func (s *Store) InboxCounts(ctx context.Context) (map[string]int, error) {
	counts := map[string]int{"new": 0, "read": 0, "saved": 0, "dismissed": 0}
	rows, err := s.Pool.Query(ctx, "SELECT state,count(*) FROM inbox GROUP BY state")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var count int
		if err = rows.Scan(&state, &count); err != nil {
			return nil, err
		}
		counts[state] = count
	}
	return counts, rows.Err()
}

func (s *Store) PageInbox(ctx context.Context, state, source, query, cursor string) (InboxPage, error) {
	page := InboxPage{Items: []InboxItem{}}
	if !oneOf(state, "new", "read", "saved", "dismissed") || source != "" && !validID(source) || len(query) > 1000 {
		return page, &ValidationError{"Invalid discovery filters"}
	}
	var after inboxCursor
	if cursor != "" {
		body, err := base64.RawURLEncoding.DecodeString(cursor)
		if len(cursor) > 512 || err != nil || json.Unmarshal(body, &after) != nil || !validID(after.ID) || after.Published.IsZero() {
			return page, &ValidationError{"Invalid discovery cursor"}
		}
	}
	var sourceID any
	if source != "" {
		sourceID = source
	}
	terms := strings.Fields(strings.ToLower(query))
	if terms == nil {
		terms = []string{}
	}
	// Literal substring terms match the UI's search; SQL wildcard characters are
	// ordinary text. Filters precede both counting and the bounded cursor page.
	filter := ` FROM inbox i JOIN sources s ON s.id=i.source_id WHERE i.state=$1 AND ($2::uuid IS NULL OR i.source_id=$2)
 AND NOT EXISTS(SELECT 1 FROM unnest($3::text[]) term WHERE strpos(lower(i.title||' '||i.author||' '||s.name||' '||i.url||' '||i.description),term)=0)`
	if err := s.Pool.QueryRow(ctx, "SELECT count(*)"+filter, state, sourceID, terms).Scan(&page.Total); err != nil {
		return page, err
	}
	var published, id any
	if cursor != "" {
		published, id = after.Published, after.ID
	}
	rows, err := s.Pool.Query(ctx, "SELECT "+inboxColumns+filter+` AND ($4::timestamptz IS NULL OR (i.published_at,i.id)<($4,$5::uuid)) ORDER BY i.published_at DESC,i.id DESC LIMIT 41`, state, sourceID, terms, published, id)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		i, err := scanInbox(rows)
		if err != nil {
			return page, err
		}
		page.Items = append(page.Items, i)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Items) > 40 {
		page.Items = page.Items[:40]
		last := page.Items[39]
		body, _ := json.Marshal(inboxCursor{last.PublishedAt, last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(body)
	}
	return page, nil
}

func (s *Server) listInbox(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	state := q.Get("state")
	if state == "" {
		state = "new"
	}
	page, err := s.Store.PageInbox(r.Context(), state, q.Get("source"), q.Get("q"), q.Get("cursor"))
	respond(w, 200, page, err)
}

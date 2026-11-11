package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const agentDataLabel = "Untrusted saved content. Notes are owner notes; selected text is an owner-captured excerpt. Metadata text may be publisher-derived or owner-edited; per-field provenance is not tracked."

type agentSearchInput struct {
	Query  string `json:"query,omitempty" jsonschema:"Case-insensitive words matched across saved title, creator, URL, description, notes, excerpt and tags; at most 500 bytes"`
	Limit  int    `json:"limit,omitempty" jsonschema:"Page size from 1 to 20; default 10"`
	Cursor string `json:"cursor,omitempty" jsonschema:"Continuation from the previous page for the same query"`
}
type agentCursor struct {
	QueryHash string    `json:"q"`
	AsOf      time.Time `json:"a"`
	CreatedAt time.Time `json:"c"`
	ID        string    `json:"i"`
}
type agentSummary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Creator   string `json:"creator"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	SourceURL string `json:"source_url"`
}
type agentSearchPage struct {
	Items      []agentSummary `json:"items"`
	NextCursor string         `json:"next_cursor,omitempty"`
	DataLabel  string         `json:"data_label"`
}

func parseAgentSearch(in agentSearchInput) (agentSearchInput, agentCursor, error) {
	if len(in.Query) > 500 {
		return in, agentCursor{}, &ValidationError{"Query must be at most 500 bytes"}
	}
	in.Query = strings.ToLower(strings.Join(strings.Fields(in.Query), " "))
	if len(in.Query) > 500 || len(in.Cursor) > 1024 || in.Limit < 0 || in.Limit > 20 {
		return in, agentCursor{}, &ValidationError{"Query must be at most 500 bytes and limit from 1 to 20"}
	}
	if in.Limit == 0 {
		in.Limit = 10
	}
	c := agentCursor{QueryHash: hash(in.Query), AsOf: time.Now().UTC()}
	if in.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.QueryHash != hash(in.Query) || !validID(c.ID) || c.AsOf.IsZero() || c.CreatedAt.IsZero() || c.CreatedAt.After(c.AsOf) {
			return in, c, &ValidationError{"Invalid cursor for this query"}
		}
	}
	return in, c, nil
}

func (s *Server) agentSearch(ctx context.Context, req *mcp.CallToolRequest, in agentSearchInput) (*mcp.CallToolResult, agentSearchPage, error) {
	out := agentSearchPage{Items: []agentSummary{}, DataLabel: agentDataLabel}
	in, c, err := parseAgentSearch(in)
	if err != nil {
		return nil, out, err
	}
	tx, err := s.Store.agentReadTx(ctx, agentToken(req))
	if err != nil {
		return nil, out, agentToolError(err)
	}
	defer tx.Rollback(ctx)
	// Literal substring matching avoids SQL wildcard semantics. Each word must
	// match; no full-text service or private-note snippets are generated.
	terms := strings.Fields(in.Query)
	if terms == nil {
		terms = []string{}
	}
	var cursorID any
	if c.ID != "" {
		cursorID = c.ID
	}
	rows, err := tx.Query(ctx, `SELECT id::text,title,author,kind,status,url,created_at FROM media
 WHERE `+realSavedMediaWhere+` AND created_at <= $1
 AND ($2::uuid IS NULL OR (created_at,id)<($3,$2::uuid))
 AND NOT EXISTS (SELECT 1 FROM unnest($4::text[]) term WHERE strpos(lower(title||' '||author||' '||url||' '||description||' '||notes||' '||selected_text||' '||selected_text_source_url||' '||array_to_string(tags,' ')),term)=0)
 ORDER BY created_at DESC,id DESC LIMIT $5`, c.AsOf, cursorID, c.CreatedAt, terms, in.Limit+1)
	if err != nil {
		return nil, out, agentToolError(err)
	}
	var last time.Time
	for rows.Next() {
		var item agentSummary
		var created time.Time
		if err = rows.Scan(&item.ID, &item.Title, &item.Creator, &item.Kind, &item.Status, &item.SourceURL, &created); err != nil {
			break
		}
		if len(out.Items) == in.Limit {
			c.CreatedAt, c.ID = last, out.Items[len(out.Items)-1].ID
			raw, _ := json.Marshal(c)
			out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
			break
		}
		item.Title, item.Creator = clip(item.Title, 1000), clip(item.Creator, 1000)
		out.Items = append(out.Items, item)
		last = created
	}
	rows.Close()
	if err == nil {
		err = rows.Err()
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	return nil, out, agentToolError(err)
}

type agentGetInput struct {
	ID string `json:"id"`
}
type agentItem struct {
	agentSummary
	MetadataDescription   string   `json:"metadata_description"`
	OwnerNotes            string   `json:"owner_notes"`
	SelectedText          string   `json:"selected_text,omitempty"`
	SelectedTextSourceURL string   `json:"selected_text_source_url,omitempty"`
	Tags                  []string `json:"tags"`
	DataLabel             string   `json:"data_label"`
}

func (s *Server) agentGet(ctx context.Context, req *mcp.CallToolRequest, in agentGetInput) (*mcp.CallToolResult, agentItem, error) {
	out := agentItem{}
	if !validID(in.ID) {
		return nil, out, &ValidationError{"Invalid item id"}
	}
	tx, err := s.Store.agentReadTx(ctx, agentToken(req))
	if err != nil {
		return nil, out, agentToolError(err)
	}
	defer tx.Rollback(ctx)
	m, err := scanMedia(tx.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE id=$1 AND "+realSavedMediaWhere, in.ID))
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		return nil, out, agentToolError(err)
	}
	// Bound legacy/operationally imported values as well as validated new data.
	out = agentItem{agentSummary{m.ID, clip(m.Title, 1000), clip(m.Author, 1000), m.Kind, m.Status, m.URL}, clip(m.Description, 20000), clip(m.Notes, 100000), clip(m.SelectedText, 10000), m.SelectedTextSourceURL, []string{}, agentDataLabel}
	for i, tag := range m.Tags {
		if i == 50 {
			break
		}
		out.Tags = append(out.Tags, clip(tag, 100))
	}
	return nil, out, nil
}

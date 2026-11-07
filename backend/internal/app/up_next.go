package app

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"
)

// UpNext is owner-only state, deliberately separate from every media DTO.
type UpNext struct {
	Version int64    `json:"version"`
	IDs     []string `json:"ids"`
}

type upNextInput struct {
	ExpectedVersion *int64 `json:"expected_version"`
	ID              string `json:"id"`
	Action          string `json:"action"`
}

// Every status/delete writer takes this lock before media locks. Capture takes
// its token/URL gates first; no other queue writer takes those gates, so there
// is no reverse lock dependency.
func lockUpNext(ctx context.Context, tx pgx.Tx) (int64, error) {
	var version int64
	err := tx.QueryRow(ctx, "SELECT version FROM up_next_state WHERE singleton FOR UPDATE").Scan(&version)
	return version, err
}

func readUpNext(ctx context.Context, db interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (UpNext, error) {
	var q UpNext
	err := db.QueryRow(ctx, `SELECT version, ARRAY(SELECT media_id::text FROM up_next ORDER BY position) FROM up_next_state WHERE singleton`).Scan(&q.Version, &q.IDs)
	return q, err
}
func (s *Store) UpNext(ctx context.Context) (UpNext, error) { return readUpNext(ctx, s.Pool) }

// Membership and the corresponding media must describe the same moment, even
// when another request completes or deletes an item between the two reads.
func (s *Store) librarySnapshot(ctx context.Context) ([]Media, UpNext, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, UpNext{}, err
	}
	defer tx.Rollback(ctx)
	queue, err := readUpNext(ctx, tx)
	if err != nil {
		return nil, queue, err
	}
	media, err := listMedia(ctx, tx)
	if err != nil {
		return nil, queue, err
	}
	return media, queue, tx.Commit(ctx)
}

// Caller holds the queue lock. Gaps from removals are harmless: position is only
// used for ordering, and explicit reorder rewrites it contiguously.
func removeUpNext(ctx context.Context, tx pgx.Tx, id string) error {
	result, err := tx.Exec(ctx, "DELETE FROM up_next WHERE media_id=$1", id)
	if err == nil && result.RowsAffected() > 0 {
		_, err = tx.Exec(ctx, "UPDATE up_next_state SET version=version+1 WHERE singleton")
	}
	return err
}

var errUpNextConflict = errors.New("Up next changed in another tab. The latest order is shown; try again.")

func reorderUpNext(ids []string, id, action string) ([]string, bool, error) {
	result := slices.Clone(ids)
	index := slices.Index(result, id)
	switch action {
	case "add":
		if index >= 0 {
			return result, false, nil
		}
		return append(result, id), true, nil
	case "remove":
		if index < 0 {
			return result, false, nil
		}
		return slices.Delete(result, index, index+1), true, nil
	case "up", "down":
		if index < 0 {
			return nil, false, &ValidationError{"This item is no longer in Up next."}
		}
		neighbor := index - 1
		if action == "down" {
			neighbor = index + 1
		}
		if neighbor < 0 || neighbor >= len(result) {
			return result, false, nil
		}
		result[index], result[neighbor] = result[neighbor], result[index]
		return result, true, nil
	default:
		return nil, false, &ValidationError{"action must be add, remove, up, or down"}
	}
}
func (s *Store) changeUpNext(ctx context.Context, in upNextInput) (UpNext, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return UpNext{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = lockUpNext(ctx, tx); err != nil {
		return UpNext{}, err
	}
	q, err := readUpNext(ctx, tx)
	if err != nil {
		return q, err
	}
	if in.ExpectedVersion == nil {
		return q, &ValidationError{"expected_version is required"}
	}
	if q.Version != *in.ExpectedVersion {
		return q, errUpNextConflict
	}
	if in.Action == "add" {
		var status string
		err = tx.QueryRow(ctx, "SELECT status FROM media WHERE id=$1 AND NOT is_demo FOR UPDATE", in.ID).Scan(&status)
		if errors.Is(err, pgx.ErrNoRows) {
			return q, ErrNotFound
		}
		if err != nil {
			return q, err
		}
		if status != "pending" {
			return q, &ValidationError{"Only unfinished library items can be added to Up next."}
		}
	}
	ids, changed, err := reorderUpNext(q.IDs, in.ID, in.Action)
	if err != nil || !changed {
		return q, err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM up_next"); err != nil {
		return q, err
	}
	for position, id := range ids {
		if _, err = tx.Exec(ctx, "INSERT INTO up_next(media_id,position) VALUES($1,$2)", id, position); err != nil {
			return q, err
		}
	}
	if err = tx.QueryRow(ctx, "UPDATE up_next_state SET version=version+1 WHERE singleton RETURNING version").Scan(&q.Version); err != nil {
		return q, err
	}
	q.IDs = ids
	return q, tx.Commit(ctx)
}
func (s *Server) upNext(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" || r.Method == "HEAD" {
		q, err := s.Store.UpNext(r.Context())
		respond(w, 200, q, err)
		return
	}
	var in upNextInput
	if !decode(w, r, &in) {
		return
	}
	if !validID(in.ID) {
		respond(w, 400, nil, &ValidationError{"Invalid item ID"})
		return
	}
	q, err := s.Store.changeUpNext(r.Context(), in)
	if errors.Is(err, errUpNextConflict) {
		writeJSON(w, 409, map[string]any{"error": err.Error(), "code": "up_next_conflict", "up_next": q})
		return
	}
	respond(w, 200, q, err)
}

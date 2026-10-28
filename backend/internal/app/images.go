package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func isImagePath(value string) bool {
	return strings.HasPrefix(value, "/api/images/") && validID(strings.TrimPrefix(value, "/api/images/"))
}

// The browser resizes before upload. Decode and re-encode server-side too, so
// untrusted files cannot become active content or unbounded image allocations.
func (s *Server) uploadImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	defer r.Body.Close()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, 413, map[string]string{"error": "Choose an image smaller than 2 MiB after optimization."})
		return
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil || !oneOf(format, "jpeg", "png") || config.Width < 1 || config.Height < 1 || config.Width > 1600 || config.Height > 1600 {
		writeJSON(w, 400, map[string]string{"error": "Upload a JPEG or PNG up to 1600 × 1600 pixels."})
		return
	}
	decoded, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Could not decode this image."})
		return
	}
	var clean bytes.Buffer
	if err = jpeg.Encode(&clean, decoded, &jpeg.Options{Quality: 85}); err != nil {
		respond(w, 500, nil, err)
		return
	}
	if clean.Len() > 2<<20 {
		writeJSON(w, 400, map[string]string{"error": "Optimized image is too large. Choose a smaller image."})
		return
	}
	id := newID()
	_, err = s.Store.Pool.Exec(r.Context(), "INSERT INTO images(id,body) VALUES($1,$2)", id, clean.Bytes())
	// Abandoned draft uploads expire; images attached to any item are retained.
	if err == nil {
		_, err = s.Store.Pool.Exec(r.Context(), "DELETE FROM images WHERE created_at < now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM media WHERE cover_url='/api/images/'||images.id::text)")
	}
	respond(w, 201, map[string]string{"url": "/api/images/" + id}, err)
}

func (s *Server) image(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		http.NotFound(w, r)
		return
	}
	owner, err := s.authenticated(r)
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	var body []byte
	err = s.Store.Pool.QueryRow(r.Context(), `SELECT body FROM images WHERE id=$1 AND ($2 OR EXISTS(SELECT 1 FROM media WHERE NOT is_demo AND visibility='public' AND cover_url='/api/images/'||images.id::text))`, id, owner).Scan(&body)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, id+".jpg", time.Time{}, bytes.NewReader(body))
}

func (s *Server) exportLibrary(w http.ResponseWriter, r *http.Request) {
	// One snapshot keeps item paths and attached image bytes consistent.
	tx, err := s.Store.Pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), "SELECT "+mediaColumns+" FROM media WHERE NOT is_demo ORDER BY created_at,id")
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	items := []Media{}
	for rows.Next() {
		m, e := scanMedia(rows)
		if e != nil {
			rows.Close()
			respond(w, 500, nil, e)
			return
		}
		if isImagePath(m.CoverURL) {
			m.CoverURL = "images/" + strings.TrimPrefix(m.CoverURL, "/api/images/") + ".jpg"
		}
		items = append(items, m)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		respond(w, 500, nil, err)
		return
	}
	images, err := tx.Query(r.Context(), `SELECT id::text,body FROM images WHERE EXISTS(SELECT 1 FROM media WHERE NOT is_demo AND cover_url='/api/images/'||images.id::text) ORDER BY id`)
	if err != nil {
		respond(w, 500, nil, err)
		return
	}
	defer images.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="margin-export.zip"`)
	w.Header().Set("Cache-Control", "no-store")
	archive := zip.NewWriter(w)
	file, err := archive.Create("library.json")
	if err == nil {
		err = json.NewEncoder(file).Encode(struct {
			Version    int       `json:"version"`
			ExportedAt time.Time `json:"exported_at"`
			Media      []Media   `json:"media"`
		}{1, time.Now().UTC(), items})
	}
	for err == nil && images.Next() {
		var id string
		var body []byte
		if err = images.Scan(&id, &body); err != nil {
			break
		}
		file, err = archive.Create("images/" + id + ".jpg")
		if err == nil {
			_, err = file.Write(body)
		}
	}
	if err == nil {
		err = images.Err()
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		return
	} // Incomplete downloads fail ZIP validation instead of looking complete.
	_ = archive.Close()
}

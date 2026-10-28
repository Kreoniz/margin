package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"net/http"

	"github.com/jackc/pgx/v5"
)

const devFixtureKey = "dev_media_fixtures_v1"

type devFixture struct {
	MediaID string `json:"media_id"`
	ImageID string `json:"image_id"`
}

func (s *Store) devFixtureCount(ctx context.Context) (int, error) {
	var count int
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM media WHERE id::text IN (
 SELECT entry->>'media_id' FROM jsonb_array_elements(COALESCE(
 (SELECT value::jsonb FROM app_settings WHERE key=$1),'[]'::jsonb)) entry)`, devFixtureKey).Scan(&count)
	return count, err
}

func (s *Server) devFixtures(w http.ResponseWriter, r *http.Request) {
	count, err := s.Store.updateDevFixtures(r.Context(), r.Method == http.MethodDelete)
	respond(w, 200, map[string]int{"count": count}, err)
}

func (s *Store) updateDevFixtures(ctx context.Context, remove bool) (int, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	// Serialize loads and cleanup, including concurrent shortcut/button presses.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(6842148802)"); err != nil {
		return 0, err
	}
	var manifest string
	err = tx.QueryRow(ctx, "SELECT value FROM app_settings WHERE key=$1", devFixtureKey).Scan(&manifest)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	fixtures := []devFixture{}
	if manifest != "" {
		if err = json.Unmarshal([]byte(manifest), &fixtures); err != nil {
			return 0, err
		}
	}
	if remove {
		ids := []string{}
		for _, fixture := range fixtures {
			ids = append(ids, fixture.MediaID)
		}
		if _, err = tx.Exec(ctx, "UPDATE inbox SET state='read',media_id=NULL WHERE media_id::text=ANY($1)", ids); err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, "DELETE FROM media WHERE id::text=ANY($1)", ids); err != nil {
			return 0, err
		}
		for _, fixture := range fixtures {
			if _, err = tx.Exec(ctx, "DELETE FROM images WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM media WHERE cover_url='/api/images/'||images.id::text)", fixture.ImageID); err != nil {
				return 0, err
			}
		}
		if _, err = tx.Exec(ctx, "DELETE FROM app_settings WHERE key=$1", devFixtureKey); err != nil {
			return 0, err
		}
		return 0, tx.Commit(ctx)
	}
	if len(fixtures) > 0 {
		return len(fixtures), tx.Commit(ctx)
	}
	examples := []struct{ kind, title string }{
		{"book", "The Quiet Atlas"}, {"article", "A Walk Through WebAssembly"}, {"paper", "Small Models, Big Questions"},
		{"video", "Making Room for Ideas"}, {"movie", "The Last Observatory"}, {"anime", "Letters from the Moon"},
		{"manga", "The Lantern District"}, {"game", "Gardens of Tomorrow"}, {"other", "A Field Guide to Curiosity"},
	}
	for i, example := range examples {
		imageID := newID()
		m := NewMedia()
		m.Title = "[Demo] " + example.title
		m.Author = "Margin demo studio"
		m.Kind = example.kind
		m.Visibility = "public"
		m.Tags = []string{"demo", example.kind}
		m.NeedsReview = i%3 == 0
		m.Description = "Fictional development example for previewing " + example.kind + " layouts. This is dummy data."
		m.Notes = "Development fixture. Remove with Settings → Development → Clear demo data."
		m.CoverURL = "/api/images/" + imageID
		status := "pending"
		if i%3 == 1 {
			status = "done"
		}
		m, err = (MediaInput{Status: &status}).Apply(m)
		if err != nil {
			return 0, err
		}
		var created bool
		m, created, err = insertMedia(ctx, tx, m)
		if err != nil {
			return 0, err
		}
		// A coincidentally matching real item is never adopted as a fixture.
		if !created {
			continue
		}
		body, err := devCover(example.kind, i)
		if err != nil {
			return 0, err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO images(id,body) VALUES($1,$2)", imageID, body); err != nil {
			return 0, err
		}
		fixtures = append(fixtures, devFixture{m.ID, imageID})
	}
	encoded, err := json.Marshal(fixtures)
	if err != nil {
		return 0, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", devFixtureKey, string(encoded)); err != nil {
		return 0, err
	}
	return len(fixtures), tx.Commit(ctx)
}

// Offline geometric covers exercise portrait, landscape, and square layouts.
func devCover(kind string, index int) ([]byte, error) {
	width, height := 640, 640
	if oneOf(kind, "book", "manga") {
		width, height = 480, 720
	}
	if oneOf(kind, "video", "movie", "anime", "game") {
		width, height = 960, 540
	}
	palette := []color.RGBA{{43, 91, 80, 255}, {75, 87, 145, 255}, {142, 84, 66, 255}, {88, 71, 120, 255}, {38, 91, 118, 255}, {137, 79, 104, 255}, {111, 104, 57, 255}, {68, 104, 70, 255}, {117, 76, 51, 255}}
	base := palette[index%len(palette)]
	cover := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(cover, cover.Bounds(), image.NewUniform(base), image.Point{}, draw.Src)
	light := color.RGBA{base.R/2 + 125, base.G/2 + 125, base.B/2 + 125, 255}
	draw.Draw(cover, image.Rect(width/6, height/5, width*5/6, height*3/5), image.NewUniform(light), image.Point{}, draw.Src)
	for i := 0; i < 3; i++ {
		draw.Draw(cover, image.Rect(width/6, height*(72+i*6)/100, width*(5-i)/6, height*(74+i*6)/100), image.NewUniform(color.RGBA{239, 237, 218, 255}), image.Point{}, draw.Src)
	}
	var body bytes.Buffer
	err := jpeg.Encode(&body, cover, &jpeg.Options{Quality: 85})
	return body.Bytes(), err
}

package app

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct{ Pool *pgxpool.Pool }

func OpenStore(ctx context.Context, dsn string) (*Store, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	config.MaxConns = 10
	config.MinConns = 0
	config.MaxConnLifetime = 30 * time.Minute
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["timezone"] = "UTC"
	config.ConnConfig.RuntimeParams["statement_timeout"] = "15000"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool}, nil
}

func (s *Store) Migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serialize startup migrations across processes, without requiring extensions.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(6842148801)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"); err != nil {
		return err
	}
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, name := range files {
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)", name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(body)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES($1)", name); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

const mediaColumns = "id::text,title,author,kind,status,url,cover_url,description,notes,tags,visibility,created_at,updated_at,completed_at,needs_review"

type scanner interface{ Scan(...any) error }

func scanMedia(row scanner) (Media, error) {
	var m Media
	err := row.Scan(&m.ID, &m.Title, &m.Author, &m.Kind, &m.Status, &m.URL, &m.CoverURL, &m.Description, &m.Notes, &m.Tags, &m.Visibility, &m.CreatedAt, &m.UpdatedAt, &m.CompletedAt, &m.NeedsReview)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return m, err
}
func (s *Store) ListMedia(ctx context.Context) ([]Media, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+mediaColumns+" FROM media WHERE NOT is_demo ORDER BY created_at DESC,id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Media{}
	for rows.Next() {
		m, err := scanMedia(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}

func mediaKeys(m Media) (any, any) {
	if m.URL != "" {
		return urlKey(m.URL), nil
	}
	return nil, manualKey(m)
}
func insertMedia(ctx context.Context, tx pgx.Tx, m Media) (Media, bool, error) {
	u, mk := mediaKeys(m)
	if u != nil {
		if _, err := tx.Exec(ctx, "INSERT INTO seen_articles(url_key) VALUES($1) ON CONFLICT DO NOTHING", u); err != nil {
			return m, false, err
		}
	}
	created, err := scanMedia(tx.QueryRow(ctx, `INSERT INTO media(id,title,author,kind,status,url,url_key,manual_key,cover_url,description,notes,tags,visibility,completed_at,needs_review)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
 ON CONFLICT DO NOTHING RETURNING `+mediaColumns, newID(), m.Title, m.Author, m.Kind, m.Status, m.URL, u, mk, m.CoverURL, m.Description, m.Notes, m.Tags, m.Visibility, m.CompletedAt, m.NeedsReview))
	if !errors.Is(err, ErrNotFound) {
		return created, err == nil, err
	}
	existing, err := scanMedia(tx.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE NOT is_demo AND (url_key=$1 OR manual_key=$2)", u, mk))
	return existing, false, err
}

func (s *Store) CreateMedia(ctx context.Context, m Media) (Media, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return m, err
	}
	defer tx.Rollback(ctx)
	m, created, err := insertMedia(ctx, tx, m)
	if err != nil {
		return m, err
	}
	if !created {
		return m, &DuplicateError{m.ID}
	}
	return m, tx.Commit(ctx)
}

func (s *Store) PatchMedia(ctx context.Context, id string, in MediaInput) (Media, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Media{}, err
	}
	defer tx.Rollback(ctx)
	m, err := scanMedia(tx.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE id=$1 AND NOT is_demo FOR UPDATE", id))
	if err != nil {
		return m, err
	}
	m, err = in.Apply(m)
	if err != nil {
		return m, &ValidationError{err.Error()}
	}
	u, mk := mediaKeys(m)
	if u != nil {
		if _, err = tx.Exec(ctx, "INSERT INTO seen_articles(url_key) VALUES($1) ON CONFLICT DO NOTHING", u); err != nil {
			return m, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE media SET title=$2,author=$3,kind=$4,status=$5,url=$6,url_key=$7,manual_key=$8,cover_url=$9,description=$10,notes=$11,tags=$12,visibility=$13,completed_at=$14,needs_review=$15,updated_at=now() WHERE id=$1`, id, m.Title, m.Author, m.Kind, m.Status, m.URL, u, mk, m.CoverURL, m.Description, m.Notes, m.Tags, m.Visibility, m.CompletedAt, m.NeedsReview)
	if isUnique(err) {
		tx.Rollback(ctx)
		var existing string
		e := s.Pool.QueryRow(ctx, "SELECT id::text FROM media WHERE NOT is_demo AND (url_key=$1 OR manual_key=$2) AND id<>$3", u, mk, id).Scan(&existing)
		if e != nil {
			return m, e
		}
		return m, &DuplicateError{existing}
	}
	if err != nil {
		return m, err
	}
	m, err = scanMedia(tx.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE id=$1", id))
	if err != nil {
		return m, err
	}
	return m, tx.Commit(ctx)
}

func isUnique(err error) bool { var p *pgconn.PgError; return errors.As(err, &p) && p.Code == "23505" }

type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }
func (s *Store) DeleteMedia(ctx context.Context, id string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Block new foreign-key links before resetting existing ones. Use media_id
	// rather than URL: the library URL may have changed since the inbox save.
	var lockedID string
	if err = tx.QueryRow(ctx, "SELECT id::text FROM media WHERE id=$1 AND NOT is_demo FOR UPDATE", id).Scan(&lockedID); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE inbox SET state='read',media_id=NULL WHERE media_id=$1", id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM media WHERE id=$1", id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

const inboxColumns = "i.id::text,i.source_id::text,s.name,i.title,i.author,i.url,i.cover_url,i.description,i.published_at,i.discovered_at,i.state"

func scanInbox(row scanner) (InboxItem, error) {
	var i InboxItem
	err := row.Scan(&i.ID, &i.SourceID, &i.SourceName, &i.Title, &i.Author, &i.URL, &i.CoverURL, &i.Description, &i.PublishedAt, &i.DiscoveredAt, &i.State)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return i, err
}
func (s *Store) ListInbox(ctx context.Context, all bool) ([]InboxItem, error) {
	filter := "WHERE i.state IN ('new','read')"
	if all {
		filter = ""
	}
	rows, err := s.Pool.Query(ctx, "SELECT "+inboxColumns+" FROM inbox i JOIN sources s ON s.id=i.source_id "+filter+" ORDER BY i.discovered_at DESC,i.id DESC LIMIT 1000")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []InboxItem{}
	for rows.Next() {
		i, err := scanInbox(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
func (s *Store) PatchInbox(ctx context.Context, id, state string) (InboxItem, error) {
	if !oneOf(state, "new", "read", "dismissed") {
		return InboxItem{}, &ValidationError{"state must be new, read, or dismissed"}
	}
	// A saved record can only be marked saved by the atomic save operation.
	return scanInbox(s.Pool.QueryRow(ctx, `UPDATE inbox i SET state=$2 FROM sources s WHERE i.id=$1 AND s.id=i.source_id RETURNING `+inboxColumns, id, state))
}
func (s *Store) SaveInbox(ctx context.Context, id string) (Media, bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Media{}, false, err
	}
	defer tx.Rollback(ctx)
	i, err := scanInbox(tx.QueryRow(ctx, "SELECT "+inboxColumns+" FROM inbox i JOIN sources s ON s.id=i.source_id WHERE i.id=$1 FOR UPDATE OF i", id))
	if err != nil {
		return Media{}, false, err
	}
	// Keep the original save relationship even after the user edits the library
	// URL. URL uniqueness alone cannot guarantee idempotence after such an edit.
	var savedID *string
	if err = tx.QueryRow(ctx, "SELECT media_id::text FROM inbox WHERE id=$1", id).Scan(&savedID); err != nil {
		return Media{}, false, err
	}
	if savedID != nil {
		m, err := scanMedia(tx.QueryRow(ctx, "SELECT "+mediaColumns+" FROM media WHERE id=$1 AND NOT is_demo", *savedID))
		if err != nil && !errors.Is(err, ErrNotFound) {
			return Media{}, false, err
		}
		if err == nil {
			if _, err = tx.Exec(ctx, "UPDATE inbox SET state='saved' WHERE id=$1", id); err != nil {
				return m, false, err
			}
			return m, false, tx.Commit(ctx)
		}
		// Older saves could link to a quarantined sample. Resolve a real item
		// from inbox data and replace that link in this same transaction.
	}
	m, err := mediaFromInbox(i)
	if err != nil {
		return m, false, err
	}
	m, created, err := insertMedia(ctx, tx, m)
	if err != nil {
		return m, false, err
	}
	if _, err = tx.Exec(ctx, "UPDATE inbox SET state='saved',media_id=$2 WHERE id=$1", id, m.ID); err != nil {
		return m, false, err
	}
	return m, created, tx.Commit(ctx)
}

const sourceColumns = "s.id::text,s.name,s.site_url,s.feed_url,s.parser,s.enabled,s.auto_save,s.interval_minutes,s.last_sync,s.next_sync,s.last_error,(SELECT count(*)::int FROM inbox i WHERE i.source_id=s.id)"

func scanSource(row scanner) (Source, error) {
	var s Source
	err := row.Scan(&s.ID, &s.Name, &s.SiteURL, &s.FeedURL, &s.Parser, &s.Enabled, &s.AutoSave, &s.IntervalMinutes, &s.LastSync, &s.NextSync, &s.LastError, &s.ItemCount)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return s, err
}
func (s *Store) ListSources(ctx context.Context) ([]Source, error) {
	rows, err := s.Pool.Query(ctx, "SELECT "+sourceColumns+" FROM sources s ORDER BY s.name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Source{}
	for rows.Next() {
		item, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func sourceKey(src Source) string { return urlKey(src.FeedURL) }
func insertSource(ctx context.Context, tx pgx.Tx, src Source) (Source, error) {
	return scanSource(tx.QueryRow(ctx, `INSERT INTO sources AS s(id,name,site_url,feed_url,source_key,parser,interval_minutes,auto_save,auto_save_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 THEN clock_timestamp() ELSE NULL END) RETURNING `+sourceColumns, newID(), src.Name, src.SiteURL, src.FeedURL, sourceKey(src), src.Parser, src.IntervalMinutes, src.AutoSave))
}
func (s *Store) CreateSource(ctx context.Context, src Source) (Source, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return src, err
	}
	defer tx.Rollback(ctx)
	src, err = insertSource(ctx, tx, src)
	if isUnique(err) {
		return src, &ValidationError{"This source is already subscribed"}
	}
	if err != nil {
		return src, err
	}
	return src, tx.Commit(ctx)
}
func validateSourcePatch(p SourcePatch) error {
	if p.IntervalMinutes != nil && (*p.IntervalMinutes < 5 || *p.IntervalMinutes > 10080) {
		return &ValidationError{"interval_minutes must be between 5 and 10080"}
	}
	if p.Name != nil && (strings.TrimSpace(*p.Name) == "" || len(*p.Name) > 200) {
		return &ValidationError{"name must contain 1 to 200 bytes"}
	}
	return nil
}
func (s *Store) PatchSource(ctx context.Context, id string, p SourcePatch) (Source, error) {
	if err := validateSourcePatch(p); err != nil {
		return Source{}, err
	}
	return scanSource(s.Pool.QueryRow(ctx, `UPDATE sources s SET name=COALESCE($2,name),enabled=COALESCE($3,enabled),interval_minutes=COALESCE($4,interval_minutes),
 auto_save=COALESCE($5,auto_save),auto_save_after=CASE WHEN $5::boolean=true AND NOT auto_save THEN clock_timestamp() ELSE auto_save_after END,
 next_sync=CASE WHEN $3::boolean=true AND NOT enabled THEN now() WHEN $4::integer IS NOT NULL THEN COALESCE(last_sync,now())+make_interval(mins=>$4::integer) ELSE next_sync END
 WHERE id=$1 RETURNING `+sourceColumns, id, p.Name, p.Enabled, p.IntervalMinutes, p.AutoSave))
}
func (s *Store) DeleteSource(ctx context.Context, id string) error {
	tag, err := s.Pool.Exec(ctx, "DELETE FROM sources WHERE id=$1", id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// ClaimSource persists a short lease before doing network work. A crashed process
// leaves a recoverable lease; multiple app instances do not collect the same source.
func (s *Store) ClaimSource(ctx context.Context, force bool, started time.Time) (Source, string, error) {
	token := newID()
	query := `UPDATE sources s SET lease_token=$1,lease_until=now()+interval '2 minutes' WHERE s.id=(SELECT id FROM sources WHERE enabled AND (lease_until IS NULL OR lease_until<now()) AND (next_sync IS NULL OR next_sync<=now() OR ($2 AND (last_sync IS NULL OR last_sync<$3))) ORDER BY next_sync NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ` + sourceColumns
	src, err := scanSource(s.Pool.QueryRow(ctx, query, token, force, started))
	return src, token, err
}
func (s *Store) FinishSource(ctx context.Context, src Source, token string, items []InboxItem, syncErr error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var autoSave bool
	var cutoff *time.Time
	if err = tx.QueryRow(ctx, "SELECT auto_save,auto_save_after FROM sources WHERE id=$1 AND lease_token=$2 FOR UPDATE", src.ID, token).Scan(&autoSave, &cutoff); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if syncErr == nil {
		for _, i := range items {
			// A persistent seen key prevents deleted/read/dismissed records from
			// becoming new again, including after source deletion/recreation.
			tag, err := tx.Exec(ctx, "INSERT INTO seen_articles(url_key) VALUES($1) ON CONFLICT DO NOTHING", urlKey(i.URL))
			if err != nil {
				return err
			}
			unseen := tag.RowsAffected() == 1
			inboxID := newID()
			tag, err = tx.Exec(ctx, `INSERT INTO inbox(id,source_id,title,author,url,url_key,cover_url,description,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(url_key) DO NOTHING`, inboxID, src.ID, i.Title, i.Author, i.URL, urlKey(i.URL), i.CoverURL, i.Description, i.PublishedAt)
			if err != nil {
				return err
			}
			if unseen && tag.RowsAffected() == 1 && autoSave && cutoff != nil && !i.PublishedUnknown && !i.PublishedAt.Before(*cutoff) {
				m, err := mediaFromInbox(i)
				if err != nil {
					return err
				}
				m.NeedsReview = true
				m, _, err = insertMedia(ctx, tx, m)
				if err != nil {
					return err
				}
				if _, err = tx.Exec(ctx, "UPDATE inbox SET state='saved',media_id=$2 WHERE id=$1", inboxID, m.ID); err != nil {
					return err
				}
			}
		}
	}
	errorText := ""
	if syncErr != nil {
		errorText = clip(syncErr.Error(), 1000)
	}
	if _, err = tx.Exec(ctx, "UPDATE sources SET last_sync=now(),next_sync=now()+make_interval(mins=>interval_minutes),last_error=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2", src.ID, token, errorText); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) SeedDefaults(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(6842148802)"); err != nil {
		return err
	}
	var seeded bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM app_settings WHERE key='default_sources_v1')").Scan(&seeded); err != nil {
		return err
	}
	if seeded {
		return tx.Commit(ctx)
	}
	for _, src := range DefaultSources() {
		if _, err = insertSource(ctx, tx, src); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "INSERT INTO app_settings(key,value) VALUES('default_sources_v1','seeded')"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func mediaFromInbox(i InboxItem) (Media, error) {
	m := NewMedia()
	m.Title = i.Title
	m.Author = i.Author
	m.URL = i.URL
	m.CoverURL = i.CoverURL
	m.Description = i.Description
	m.Kind = "article"
	if strings.Contains(strings.ToLower(i.URL), ".pdf") {
		m.Kind = "paper"
	}
	m, err := (MediaInput{}).Apply(m)
	if err != nil {
		return m, err
	}
	return m, nil
}

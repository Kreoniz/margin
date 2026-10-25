CREATE TABLE media (
 id uuid PRIMARY KEY,
 title text NOT NULL, author text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN ('book','article','paper','video','movie','anime','manga','game','other')),
 status text NOT NULL CHECK(status IN ('later','active','completed')),
 url text NOT NULL DEFAULT '', url_key text UNIQUE,
 manual_key text UNIQUE,
 cover_url text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 tags text[] NOT NULL DEFAULT '{}', favorite boolean NOT NULL DEFAULT false,
 progress double precision NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1e12),
 total double precision NOT NULL DEFAULT 100 CHECK(total >= 0 AND total <= 1e12),
 unit text NOT NULL DEFAULT '%', rating integer NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 CHECK((url = '' AND manual_key IS NOT NULL AND url_key IS NULL) OR (url <> '' AND url_key IS NOT NULL AND manual_key IS NULL)),
 CHECK(total=0 OR progress<=total)
);
CREATE TABLE sources (
 id uuid PRIMARY KEY, name text NOT NULL, site_url text NOT NULL, feed_url text NOT NULL,
 source_key text NOT NULL UNIQUE, parser text NOT NULL CHECK(parser IN ('rss','html')),
 enabled boolean NOT NULL DEFAULT true,
 interval_minutes integer NOT NULL DEFAULT 60 CHECK(interval_minutes BETWEEN 5 AND 10080),
 last_sync timestamptz, next_sync timestamptz DEFAULT now(), last_error text NOT NULL DEFAULT '',
 lease_token uuid, lease_until timestamptz
);
CREATE INDEX sources_due ON sources(next_sync) WHERE enabled;
CREATE TABLE inbox (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
 title text NOT NULL, author text NOT NULL DEFAULT '', url text NOT NULL, url_key text NOT NULL UNIQUE,
 cover_url text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
 published_at timestamptz NOT NULL, discovered_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'new' CHECK(state IN ('new','read','dismissed','saved')),
 media_id uuid REFERENCES media(id) ON DELETE SET NULL
);
CREATE INDEX inbox_newest ON inbox(discovered_at DESC);
CREATE INDEX inbox_source ON inbox(source_id);
CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL);

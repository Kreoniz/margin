-- Identify the old samples BEFORE removing the evidence fields. The seed wrote
-- all rows in one transaction: updated_at = created_at + ordinal days. Requiring
-- that exact timestamp and every original value deliberately favors false
-- negatives over quarantining a personal record.
ALTER TABLE media ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public'));
ALTER TABLE media ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
WITH original(n,title,author,kind,status,url,cover_url,description,notes,tags,favorite,progress,total,unit,rating) AS (VALUES
 (1,'The Creative Act','Rick Rubin','book','active','','https://covers.openlibrary.org/b/isbn/9780593652886-L.jpg','A field guide to noticing, making, and trusting the work.','',ARRAY['creativity','slow reading']::text[],true,154,432,'pages',0),
 (2,'Designing Data-Intensive Applications','Martin Kleppmann','book','active','','https://covers.openlibrary.org/b/isbn/9781449373320-L.jpg','The ideas behind reliable, scalable systems. One chapter at a time.','',ARRAY['engineering','systems']::text[],true,136,616,'pages',0),
 (3,'Frieren: Beyond Journey’s End','Kanehito Yamada & Tsukasa Abe','anime','active','','','An unhurried journey through memory, friendship, and the years between adventures.','',ARRAY['fantasy','quiet evenings']::text[],false,9,28,'episodes',0),
 (4,'Hollow Knight','Team Cherry','game','active','https://www.hollowknight.com/','','Getting happily lost beneath Hallownest. Still avoiding the Soul Master.','',ARRAY['exploration','indie']::text[],false,18,40,'hours',0),
 (5,'Dune','Frank Herbert','book','later','','https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg','Desert worlds, uneasy power, and a very long reading weekend.','',ARRAY['science fiction']::text[],false,0,688,'pages',0),
 (6,'A Philosophy of Software Design','John Ousterhout','book','later','','https://covers.openlibrary.org/b/isbn/9781732102200-L.jpg','A short book on reducing complexity and designing deeper modules.','',ARRAY['engineering','craft']::text[],false,0,196,'pages',0),
 (7,'Arrival','Denis Villeneuve','movie','completed','','','Language as a way of seeing time. A film to sit with afterward.','Rewatch after reading Story of Your Life.',ARRAY['science fiction','language']::text[],true,116,116,'minutes',5),
 (8,'Attention Is All You Need','Ashish Vaswani et al.','paper','completed','https://arxiv.org/abs/1706.03762','','The Transformer paper. Keep the architecture diagram close by.','',ARRAY['machine learning','foundations']::text[],false,11,11,'pages',5),
 (9,'A Visual Introduction to Machine Learning','R2D3','article','later','https://www.r2d3.us/visual-intro-to-machine-learning-part-1/','','Decision trees explained through a patient, visual walkthrough.','',ARRAY['machine learning','visual thinking']::text[],false,0,100,'%',0),
 (10,'Perfect Days','Wim Wenders','movie','later','','','Small rituals, cassette tapes, and the texture of an ordinary day.','',ARRAY['quiet evenings','cinema']::text[],false,0,124,'minutes',0),
 (11,'Look Back','Tatsuki Fujimoto','manga','completed','','','A small, moving story about drawing and the people who change your work.','',ARRAY['creativity','friendship']::text[],false,144,144,'pages',5),
 (12,'The Art of Noticing','Rob Walker','book','later','','https://covers.openlibrary.org/b/isbn/9780525521242-L.jpg','Tiny exercises for paying better attention to the world nearby.','',ARRAY['creativity','attention']::text[],false,0,256,'pages',0)
)
UPDATE media m SET is_demo=true FROM original o
WHERE EXISTS(SELECT 1 FROM app_settings WHERE key='demo_library_v1' AND value='seeded')
 -- The seed never linked inbox entries: a save is explicit personal intent.
 AND NOT EXISTS(SELECT 1 FROM inbox i WHERE i.media_id=m.id)
 AND m.title=o.title AND m.author=o.author AND m.kind=o.kind AND m.status=o.status
 -- The old normalizer stripped the R2D3 seed's non-root trailing slash.
 AND (m.url=o.url OR (o.n=9 AND m.url=rtrim(o.url,'/')))
 AND m.cover_url=o.cover_url AND m.description=o.description
 AND m.notes=o.notes AND m.tags=o.tags AND m.favorite=o.favorite
 AND m.progress=o.progress AND m.total=o.total AND m.unit=o.unit AND m.rating=o.rating
 AND m.created_at=m.updated_at-make_interval(days=>o.n)
 AND ((o.status='completed' AND m.completed_at=m.created_at) OR (o.status<>'completed' AND m.completed_at IS NULL));
ALTER TABLE media DROP CONSTRAINT media_status_check;
UPDATE media SET status=CASE WHEN status='completed' THEN 'done' ELSE 'pending' END;
ALTER TABLE media ADD CONSTRAINT media_status_check CHECK(status IN ('pending','done'));
ALTER TABLE media DROP COLUMN progress, DROP COLUMN total, DROP COLUMN unit, DROP COLUMN favorite, DROP COLUMN rating;
ALTER TABLE sources ADD COLUMN auto_save boolean NOT NULL DEFAULT false;
ALTER TABLE sources ADD COLUMN auto_save_after timestamptz;
-- Remember discoveries even when their source/inbox or library record is deleted.
CREATE TABLE seen_articles (url_key text PRIMARY KEY, first_seen_at timestamptz NOT NULL DEFAULT now());
INSERT INTO seen_articles(url_key,first_seen_at) SELECT url_key,discovered_at FROM inbox ON CONFLICT DO NOTHING;
INSERT INTO seen_articles(url_key,first_seen_at) SELECT url_key,created_at FROM media WHERE url_key IS NOT NULL ON CONFLICT DO NOTHING;
CREATE TABLE owner_credentials (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), password_hash text NOT NULL);
CREATE TABLE owner_sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE INDEX owner_sessions_expiry ON owner_sessions(expires_at);
CREATE TABLE integration_token (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), token_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

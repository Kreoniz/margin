-- Quarantined samples must not reserve identities in the personal library.
-- Keep their keys and all seen history intact; only real records deduplicate.
ALTER TABLE media DROP CONSTRAINT media_url_key_key;
ALTER TABLE media DROP CONSTRAINT media_manual_key_key;
CREATE UNIQUE INDEX media_real_url_key ON media(url_key) WHERE NOT is_demo;
CREATE UNIQUE INDEX media_real_manual_key ON media(manual_key) WHERE NOT is_demo;

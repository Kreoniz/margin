ALTER TABLE media ADD COLUMN kind_explicit boolean NOT NULL DEFAULT false;
ALTER TABLE media ADD COLUMN auto_added boolean NOT NULL DEFAULT false;
-- Automatic saves insert linked inbox and media rows in the same transaction.
-- Do not label later deliberate Discover saves as automatic additions.
UPDATE media m SET auto_added=true FROM inbox i
 WHERE i.media_id=m.id AND i.discovered_at=m.created_at;
-- Preserve the intent of existing stored classifications on future retries.
UPDATE media SET kind_explicit=true WHERE metadata_state<>'pending';
CREATE INDEX inbox_state_page ON inbox(state,published_at DESC,id DESC);

-- Repair historical missing uploads before enforcing attachment integrity.
UPDATE media SET cover_url=lower(cover_url)
 WHERE cover_url ~ '^/api/images/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
UPDATE media SET cover_url=''
 WHERE cover_url LIKE '/api/images/%'
 AND NOT EXISTS(SELECT 1 FROM images WHERE '/api/images/'||images.id::text=media.cover_url);
ALTER TABLE media ADD COLUMN cover_image_id uuid GENERATED ALWAYS AS
 (CASE WHEN cover_url ~ '^/api/images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN substring(cover_url from 13)::uuid ELSE NULL END) STORED
 REFERENCES images(id) ON DELETE RESTRICT;
CREATE INDEX media_cover_image ON media(cover_image_id) WHERE cover_image_id IS NOT NULL;

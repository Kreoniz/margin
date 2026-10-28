ALTER TABLE media
 ADD COLUMN metadata_state text NOT NULL DEFAULT '' CHECK (metadata_state IN ('','pending','ready','partial')),
 ADD COLUMN metadata_warning text NOT NULL DEFAULT '',
 ADD COLUMN metadata_lease_token uuid,
 ADD COLUMN metadata_lease_until timestamptz;
CREATE INDEX media_metadata_pending ON media(created_at) WHERE metadata_state='pending' AND NOT is_demo;

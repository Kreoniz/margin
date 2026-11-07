-- Preserve supplied values through deferred enrichment, even when they look
-- generated or intentionally empty. Historical intent cannot be reconstructed.
ALTER TABLE media ADD COLUMN title_explicit boolean NOT NULL DEFAULT false;
ALTER TABLE media ADD COLUMN author_explicit boolean NOT NULL DEFAULT false;

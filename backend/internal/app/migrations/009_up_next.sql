-- A private, explicitly chosen shortlist. Existing saves start outside it.
CREATE TABLE up_next_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)
);
INSERT INTO up_next_state DEFAULT VALUES;
CREATE TABLE up_next (
    media_id uuid PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    position integer NOT NULL UNIQUE CHECK (position >= 0)
);

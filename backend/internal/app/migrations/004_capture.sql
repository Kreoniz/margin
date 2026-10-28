ALTER TABLE media ADD COLUMN needs_review boolean NOT NULL DEFAULT false;

CREATE TABLE images (
  id uuid PRIMARY KEY,
  body bytea NOT NULL CHECK (octet_length(body) <= 2097152),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A separate opt-in credential; submission tokens retain their add-only scope.
CREATE TABLE browser_token (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

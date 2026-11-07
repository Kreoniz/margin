-- MCP credentials have no relationship to browser/submission credentials.
CREATE TABLE agent_grants (
    scope text PRIMARY KEY CHECK (scope IN ('read','save')),
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE media ADD COLUMN selected_text text NOT NULL DEFAULT '';
ALTER TABLE media ADD COLUMN selected_text_source_url text NOT NULL DEFAULT '';
ALTER TABLE media ADD CONSTRAINT media_selection_size CHECK (octet_length(selected_text) <= 10000);
ALTER TABLE media ADD CONSTRAINT media_selection_pair CHECK ((selected_text = '') = (selected_text_source_url = ''));

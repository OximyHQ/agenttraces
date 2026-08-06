export const CLOUD_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS principals (
  id text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'anonymous',
  email text,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS principals_email_idx ON principals(lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS namespaces (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('personal','team')),
  owner_id text NOT NULL REFERENCES principals(id),
  name text NOT NULL,
  visibility_default text NOT NULL DEFAULT 'private' CHECK (visibility_default IN ('private','team')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  principal_id text NOT NULL REFERENCES principals(id),
  namespace_id text NOT NULL REFERENCES namespaces(id),
  role text NOT NULL CHECK (role IN ('member','admin','owner')),
  PRIMARY KEY(principal_id, namespace_id)
);
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES principals(id),
  namespace_id text NOT NULL REFERENCES namespaces(id),
  public_key text NOT NULL,
  token_hash text NOT NULL,
  name text NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS ingest_batches (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices(id),
  namespace_id text NOT NULL REFERENCES namespaces(id),
  object_key text NOT NULL,
  event_count integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','processed','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS traces (
  id text PRIMARY KEY,
  namespace_id text NOT NULL REFERENCES namespaces(id),
  owner_id text NOT NULL REFERENCES principals(id),
  source text NOT NULL,
  session_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  repository text,
  branch text,
  pull_request integer,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','direct_link','public')),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd double precision,
  cost_accuracy text NOT NULL DEFAULT 'unavailable',
  UNIQUE(namespace_id, source, session_id)
);
CREATE INDEX IF NOT EXISTS traces_namespace_updated_idx ON traces(namespace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS traces_repository_idx ON traces(repository, updated_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  trace_id text NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  source_event_id text NOT NULL,
  source text NOT NULL,
  kind text NOT NULL,
  role text,
  content text,
  tool_name text,
  tool_call_id text,
  command text,
  model text,
  timestamp timestamptz NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cost_usd double precision,
  cost_accuracy text,
  parser_version text NOT NULL,
  source_file text NOT NULL,
  file_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(content,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(command,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(tool_name,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(source_file,'')), 'C')
  ) STORED,
  UNIQUE(trace_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS events_trace_time_idx ON events(trace_id, timestamp, id);
CREATE INDEX IF NOT EXISTS events_search_idx ON events USING gin(search_document);
`;

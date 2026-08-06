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

CREATE TABLE IF NOT EXISTS web_identities (
  external_user_id text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES principals(id),
  namespace_id text NOT NULL REFERENCES namespaces(id),
  token_hash text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
ALTER TABLE traces ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'pending';

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
  operation_kind text,
  operation_status text,
  purpose text,
  parent_event_id text,
  child_trace_id text,
  duration_ms integer,
  input jsonb,
  output jsonb,
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

ALTER TABLE events ADD COLUMN IF NOT EXISTS operation_kind text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS operation_status text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS parent_event_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS child_trace_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE events ADD COLUMN IF NOT EXISTS input jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS output jsonb;

CREATE TABLE IF NOT EXISTS setup_links (
  id text PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  namespace_id text NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES principals(id),
  email text,
  domain text,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS setup_links_team_idx ON setup_links(namespace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_repositories (
  namespace_id text NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  repository text NOT NULL,
  created_by text NOT NULL REFERENCES principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(namespace_id, repository)
);

CREATE TABLE IF NOT EXISTS repositories (
  id text PRIMARY KEY,
  canonical_name text UNIQUE NOT NULL,
  provider text NOT NULL DEFAULT 'github',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS git_commits (
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha text NOT NULL,
  branch text,
  author_email text,
  committed_at timestamptz,
  PRIMARY KEY(repository_id, sha)
);
CREATE TABLE IF NOT EXISTS pull_requests (
  id text PRIMARY KEY,
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text,
  state text,
  url text,
  head_sha text,
  base_sha text,
  author_login text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repository_id, number)
);
CREATE TABLE IF NOT EXISTS trace_commits (
  trace_id text NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha text NOT NULL,
  evidence text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(trace_id, repository_id, commit_sha)
);
CREATE TABLE IF NOT EXISTS trace_pull_requests (
  trace_id text NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  pull_request_id text NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  evidence text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(trace_id, pull_request_id)
);
CREATE INDEX IF NOT EXISTS trace_pull_requests_pr_idx ON trace_pull_requests(pull_request_id);

CREATE TABLE IF NOT EXISTS trace_enrichments (
  trace_id text PRIMARY KEY REFERENCES traces(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL,
  stages jsonb NOT NULL DEFAULT '[]',
  outcome text NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_version text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  token_hash text UNIQUE NOT NULL,
  trace_id text NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES principals(id),
  spec jsonb NOT NULL,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS share_snapshots (
  share_id text PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
  view text NOT NULL,
  payload jsonb NOT NULL,
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS share_access (
  id text PRIMARY KEY,
  share_id text NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  viewer_hash text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mutation_confirmations (
  token_hash text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reusable_skills (
  id text PRIMARY KEY,
  namespace_id text NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  instructions jsonb NOT NULL DEFAULT '[]',
  validation jsonb NOT NULL DEFAULT '[]',
  trace_ids jsonb NOT NULL DEFAULT '[]',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','direct_link','public')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reusable_skills_lookup_idx ON reusable_skills(owner_id,created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS github_installations (
  id text PRIMARY KEY,
  namespace_id text NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  github_installation_id text UNIQUE NOT NULL,
  account_login text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

export const SOURCE_NAMES = [
  "claude_code",
  "cursor",
  "codex",
  "openclaw",
  "conductor",
  "antigravity",
  "copilot",
] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];
export type ReadMode = "incremental" | "full" | "fold";
export type ContentType = "json" | "text" | "binary";
export type Visibility = "private" | "team" | "direct_link" | "public";
export type CostAccuracy = "exact" | "estimated" | "subscription_allocated" | "unavailable";

export interface NativeEnvelope {
  schema_version: 1;
  event_id: string;
  timestamp: string;
  type: "local_session";
  device_id: string;
  source: SourceName;
  source_version?: string;
  source_file: string;
  is_backtracked: boolean;
  file_type: string;
  project_key?: string;
  session_id?: string;
  line_number?: number;
  raw: Record<string, unknown>;
  git?: { repositoryRoot: string; repository?: string; branch?: string; head: string; dirtyPaths: string[]; commits: string[] };
}

export type EventKind =
  | "user"
  | "assistant"
  | "system"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "command"
  | "file"
  | "usage"
  | "metadata"
  | "lifecycle"
  | "error";

export interface NormalizedEvent {
  id: string;
  traceId: string;
  source: SourceName;
  sourceEventId: string;
  sourceFile: string;
  fileType: string;
  parserVersion: string;
  timestamp: string;
  kind: EventKind;
  role?: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  command?: string;
  model?: string;
  repository?: string;
  branch?: string;
  pullRequest?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costAccuracy?: CostAccuracy;
  metadata: Record<string, unknown>;
}

export interface ParseResult {
  success: boolean;
  records: NormalizedEvent[];
  error?: string;
}

export interface TraceSummary {
  id: string;
  namespaceId: string;
  ownerId: string;
  source: SourceName;
  sessionId: string;
  title: string;
  summary: string;
  repository?: string;
  branch?: string;
  pullRequest?: number;
  visibility: Visibility;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  costAccuracy: CostAccuracy;
}

export interface Actor {
  principalId: string;
  teamIds: string[];
  role?: "member" | "admin" | "owner";
  shareToken?: string;
}

export interface SourceGlob {
  pattern: string;
  fileType: string;
  readMode: ReadMode;
  contentType?: ContentType;
  skipPatterns?: string[];
}

export interface SqliteQuery {
  fileType: string;
  sql: string;
  incrementalField?: string;
  dependsOn?: string;
}

export interface SourceSqlite {
  path: string;
  queries: SqliteQuery[];
}

export interface SourceDefinition {
  name: SourceName;
  displayName: string;
  detectPaths: string[];
  globs: SourceGlob[];
  sqlite: SourceSqlite[];
}

export interface CaptureCursor {
  source: SourceName;
  key: string;
  value: string;
}

export interface IngestReceipt {
  batchId: string;
  accepted: number;
  duplicates: number;
  status: "durable";
}

export interface SearchRequest {
  query: string;
  scope?: "mine" | "team" | "shared_with_me" | "all_accessible";
  repository?: string;
  source?: SourceName;
  limit?: number;
}

export interface ShareSpec {
  traceId: string;
  content: "metadata" | "summary" | "selected_messages" | "full_transcript" | "skill";
  audience: "private" | "specific_people" | "team" | "anyone_with_link" | "public";
  emails?: string[];
  teamId?: string;
  agentRetrieve: boolean;
  allowContext: boolean;
  allowSkillCreation: boolean;
  expiresAt?: string;
  maxViews?: number;
}

export function isSourceName(value: string): value is SourceName {
  return (SOURCE_NAMES as readonly string[]).includes(value);
}

export function assertNativeEnvelope(value: unknown): asserts value is NativeEnvelope {
  if (!value || typeof value !== "object") throw new Error("Envelope must be an object");
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 1) throw new Error("Unsupported envelope schema_version");
  if (record.type !== "local_session") throw new Error("Envelope type must be local_session");
  if (typeof record.event_id !== "string" || !record.event_id) throw new Error("Missing event_id");
  if (typeof record.timestamp !== "string" || Number.isNaN(Date.parse(record.timestamp))) {
    throw new Error("Invalid timestamp");
  }
  if (typeof record.source !== "string" || !isSourceName(record.source)) throw new Error("Unsupported source");
  if (typeof record.file_type !== "string" || !record.file_type) throw new Error("Missing file_type");
  if (!record.raw || typeof record.raw !== "object" || Array.isArray(record.raw)) throw new Error("raw must be an object");
}

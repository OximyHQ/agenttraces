import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Actor, IngestReceipt, NativeEnvelope, NormalizedEvent, SearchRequest, ShareSpec, SourceName,
  TraceSummary, Visibility,
} from "./contracts.js";
import { assertNativeEnvelope } from "./contracts.js";
import { LocalCrypto } from "./crypto.js";
import { ParserRegistry } from "./parsers/index.js";
import { stableId, text } from "./parsers/base.js";
import { scrubRecord } from "./redaction.js";

type Row = Record<string, unknown>;

function json(value: unknown) { return JSON.stringify(value ?? null); }
function parse<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function iso() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${randomBytes(9).toString("base64url")}`; }

export class AgentTracesStore {
  readonly db: DatabaseSync;
  readonly crypto: LocalCrypto;
  readonly parsers: ParserRegistry;

  constructor(readonly databasePath: string, readonly stateDirectory = dirname(databasePath)) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    this.crypto = new LocalCrypto(stateDirectory);
    this.parsers = new ParserRegistry();
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
    this.ensureInstallation();
  }

  close() { this.db.close(); }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS principals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, email TEXT, name TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, namespace_id TEXT NOT NULL, public_key TEXT NOT NULL, name TEXT NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS namespaces (id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility_default TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (principal_id TEXT NOT NULL, namespace_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(principal_id, namespace_id));
      CREATE TABLE IF NOT EXISTS ingest_batches (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, event_count INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spool (event_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, cipher BLOB NOT NULL, nonce BLOB NOT NULL, tag BLOB NOT NULL, state TEXT NOT NULL, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, processed_at TEXT);
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL, source TEXT NOT NULL, session_id TEXT NOT NULL,
        title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', repository TEXT, branch TEXT, pull_request INTEGER,
        visibility TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, event_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL, cost_accuracy TEXT NOT NULL DEFAULT 'unavailable',
        UNIQUE(namespace_id, source, session_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, source_event_id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL,
        role TEXT, content TEXT, tool_name TEXT, tool_call_id TEXT, command TEXT, model TEXT, timestamp TEXT NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, cost_accuracy TEXT, parser_version TEXT NOT NULL,
        source_file TEXT NOT NULL, file_type TEXT NOT NULL, metadata TEXT NOT NULL, UNIQUE(source_event_id, id)
      );
      CREATE INDEX IF NOT EXISTS events_trace_idx ON events(trace_id, timestamp);
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, principal_id TEXT, namespace_id TEXT, views TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, trace_id TEXT NOT NULL, owner_id TEXT NOT NULL, spec TEXT NOT NULL, revoked_at TEXT, view_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, instructions TEXT NOT NULL, validation TEXT NOT NULL, source_trace_ids TEXT NOT NULL, visibility TEXT NOT NULL, archived_at TEXT, created_at TEXT NOT NULL, UNIQUE(namespace_id, name));
      CREATE TABLE IF NOT EXISTS cursors (source TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source, key));
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mutation_previews (token TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL);
    `);
  }

  private ensureInstallation() {
    if (this.setting("device_id")) return;
    const principalId = id("pr_anon");
    const deviceId = id("dev");
    const namespaceId = id("ns_personal");
    const now = iso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO principals VALUES (?, 'anonymous', NULL, NULL, ?)").run(principalId, now);
      this.db.prepare("INSERT INTO devices VALUES (?, ?, ?, ?, ?, 0, ?)").run(deviceId, principalId, namespaceId, this.crypto.publicKeyPem, process.env.USER ?? "local-device", now);
      this.db.prepare("INSERT INTO namespaces VALUES (?, 'personal', ?, 'Personal', 'private', ?)").run(namespaceId, principalId, now);
      this.db.prepare("INSERT INTO memberships VALUES (?, ?, 'owner')").run(principalId, namespaceId);
      this.setSetting("principal_id", principalId);
      this.setSetting("device_id", deviceId);
      this.setSetting("namespace_id", namespaceId);
      this.setSetting("capture_enabled", "true");
      this.setSetting("privacy.default", "private");
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  setting(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined)?.value as string | undefined;
  }
  setSetting(key: string, value: string) {
    this.db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  settings() { return Object.fromEntries((this.db.prepare("SELECT key,value FROM settings ORDER BY key").all() as Row[]).map((row) => [row.key, row.value])); }

  installation() {
    return {
      principalId: this.setting("principal_id")!, deviceId: this.setting("device_id")!,
      namespaceId: this.setting("namespace_id")!, claimed: this.setting("claimed") === "true",
      captureEnabled: this.setting("capture_enabled") !== "false",
    };
  }

  actor(): Actor {
    const installation = this.installation();
    const teams = this.db.prepare("SELECT namespace_id FROM memberships WHERE principal_id=? AND namespace_id != ?").all(installation.principalId, installation.namespaceId) as Row[];
    return { principalId: installation.principalId, teamIds: teams.map((row) => String(row.namespace_id)), role: "owner" };
  }

  registerDevice(deviceId: string, publicKey: string, name = "remote-device") {
    const existing = this.db.prepare("SELECT id,principal_id,namespace_id,public_key FROM devices WHERE id=?").get(deviceId) as Row | undefined;
    if (existing) {
      if (existing.public_key !== publicKey) throw new Error("Device ID is already registered with a different key");
      return { deviceId, principalId: String(existing.principal_id), namespaceId: String(existing.namespace_id), existing: true };
    }
    if (!deviceId || !publicKey.includes("BEGIN PUBLIC KEY")) throw new Error("Invalid device registration");
    const principalId = id("pr_anon"); const namespaceId = id("ns_personal"); const now = iso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO principals VALUES (?, 'anonymous', NULL, NULL, ?)").run(principalId, now);
      this.db.prepare("INSERT INTO namespaces VALUES (?, 'personal', ?, 'Personal', 'private', ?)").run(namespaceId, principalId, now);
      this.db.prepare("INSERT INTO memberships VALUES (?, ?, 'owner')").run(principalId, namespaceId);
      this.db.prepare("INSERT INTO devices VALUES (?, ?, ?, ?, ?, 0, ?)").run(deviceId, principalId, namespaceId, publicKey, name, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { deviceId, principalId, namespaceId, existing: false };
  }

  device(deviceId: string) {
    const row = this.db.prepare("SELECT id,principal_id,namespace_id,public_key,name,claimed,created_at FROM devices WHERE id=?").get(deviceId) as Row | undefined;
    return row ? { id: String(row.id), principalId: String(row.principal_id), namespaceId: String(row.namespace_id), publicKey: String(row.public_key), name: String(row.name), claimed: Boolean(row.claimed), createdAt: String(row.created_at) } : undefined;
  }

  claim(email: string, name?: string) {
    const current = this.installation();
    const challenge = `${current.deviceId}:${email}:${randomUUID()}`;
    const signature = this.crypto.sign(challenge);
    if (!this.crypto.verify(challenge, signature)) throw new Error("Device proof failed");
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE principals SET kind='user', email=?, name=? WHERE id=?").run(email, name ?? email, current.principalId);
      this.db.prepare("UPDATE devices SET claimed=1 WHERE id=?").run(current.deviceId);
      this.setSetting("claimed", "true");
      this.audit(current.principalId, "device.claim", "device", current.deviceId, { email });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { principalId: current.principalId, deviceId: current.deviceId, email, signatureVerified: true };
  }

  createTeam(slug: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) throw new Error("Team slug must contain lowercase letters, numbers, and hyphens");
    const existing = this.db.prepare("SELECT id FROM namespaces WHERE kind='team' AND name=?").get(slug) as Row | undefined;
    if (existing) return { id: String(existing.id), slug, role: "owner", existing: true };
    const teamId = id("ns_team");
    const principalId = this.installation().principalId;
    this.db.prepare("INSERT INTO namespaces VALUES (?, 'team', ?, ?, 'team', ?)").run(teamId, principalId, slug, iso());
    this.db.prepare("INSERT INTO memberships VALUES (?, ?, 'owner')").run(principalId, teamId);
    this.setSetting(`team.policy.${teamId}.visibility`, "private");
    this.audit(principalId, "team.create", "namespace", teamId, { slug });
    return { id: teamId, slug, role: "owner", existing: false };
  }

  joinTeam(teamId: string, role: "member" | "admin" | "owner" = "member") {
    const team = this.db.prepare("SELECT id FROM namespaces WHERE id=? AND kind='team'").get(teamId);
    if (!team) throw new Error("Team not found");
    const principalId = this.installation().principalId;
    this.db.prepare("INSERT INTO memberships VALUES (?,?,?) ON CONFLICT(principal_id,namespace_id) DO UPDATE SET role=excluded.role").run(principalId, teamId, role);
    return { teamId, principalId, role };
  }

  useNamespace(namespaceId?: string) {
    const install = this.installation();
    if (!namespaceId || namespaceId === install.namespaceId || namespaceId === "personal") {
      this.setSetting("active_team_id", "");
      return { namespaceId: install.namespaceId, kind: "personal" };
    }
    const member = this.db.prepare("SELECT role FROM memberships WHERE principal_id=? AND namespace_id=?").get(install.principalId, namespaceId) as Row | undefined;
    if (!member) throw new Error("Not a member of that team");
    this.setSetting("active_team_id", namespaceId);
    return { namespaceId, kind: "team", role: String(member.role) };
  }

  setTeamPolicy(teamId: string, visibility: "private" | "team") {
    const install = this.installation();
    const member = this.db.prepare("SELECT role FROM memberships WHERE principal_id=? AND namespace_id=?").get(install.principalId, teamId) as Row | undefined;
    if (!member || !["owner", "admin"].includes(String(member.role))) throw new Error("Only a team owner or admin can change policy");
    this.setSetting(`team.policy.${teamId}.visibility`, visibility);
    this.audit(install.principalId, "team.policy.update", "namespace", teamId, { visibility });
    return { teamId, defaultVisibility: visibility };
  }

  listTeams() {
    const principalId = this.installation().principalId;
    return this.db.prepare(`SELECT n.id,n.name,m.role,n.visibility_default FROM namespaces n
      JOIN memberships m ON m.namespace_id=n.id WHERE m.principal_id=? AND n.kind='team' ORDER BY n.name`).all(principalId);
  }

  enqueue(batchId: string, envelopes: NativeEnvelope[], expectedDeviceId = this.installation().deviceId): IngestReceipt {
    const device = this.device(expectedDeviceId);
    if (!device) throw new Error("Unknown device");
    let accepted = 0; let duplicates = 0;
    this.db.exec("BEGIN");
    try {
      const known = this.db.prepare("SELECT id FROM ingest_batches WHERE id=?").get(batchId);
      if (known) {
        this.db.exec("ROLLBACK");
        return { batchId, accepted: 0, duplicates: envelopes.length, status: "durable" };
      }
      for (const envelope of envelopes) {
        assertNativeEnvelope(envelope);
        if (envelope.device_id !== expectedDeviceId) throw new Error("Envelope device_id does not match the signed device");
        const encrypted = this.crypto.encrypt(json(envelope));
        const result = this.db.prepare("INSERT OR IGNORE INTO spool(event_id,batch_id,cipher,nonce,tag,state,created_at) VALUES (?,?,?,?,?,'pending',?)")
          .run(envelope.event_id, batchId, encrypted.cipher, encrypted.nonce, encrypted.tag, iso());
        if (result.changes) accepted++; else duplicates++;
      }
      this.db.prepare("INSERT INTO ingest_batches VALUES (?,?,?,?)").run(batchId, expectedDeviceId, envelopes.length, iso());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { batchId, accepted, duplicates, status: "durable" };
  }

  processPending(limit = 500) {
    const rows = this.db.prepare("SELECT * FROM spool WHERE state IN ('pending','failed') AND attempts < 5 ORDER BY created_at LIMIT ?").all(limit) as Row[];
    let processed = 0; let failed = 0; let produced = 0;
    for (const row of rows) {
      try {
        const envelope = JSON.parse(this.crypto.decrypt({ cipher: row.cipher as Buffer, nonce: row.nonce as Buffer, tag: row.tag as Buffer })) as NativeEnvelope;
        const sanitized = { ...envelope, raw: scrubRecord(envelope.raw) };
        const result = this.parsers.parse(sanitized);
        if (!result.success) throw new Error(result.error ?? "Parser failed");
        this.persist(sanitized, result.records);
        this.db.prepare("UPDATE spool SET state='processed', processed_at=?, error=NULL, attempts=attempts+1 WHERE event_id=?").run(iso(), row.event_id as SQLInputValue);
        processed++; produced += result.records.length;
      } catch (error) {
        this.db.prepare("UPDATE spool SET state='failed', error=?, attempts=attempts+1 WHERE event_id=?").run(error instanceof Error ? error.message : String(error), row.event_id as SQLInputValue);
        failed++;
      }
    }
    return { processed, failed, produced, remaining: Number((this.db.prepare("SELECT COUNT(*) AS count FROM spool WHERE state != 'processed'").get() as Row).count) };
  }

  private persist(envelope: NativeEnvelope, records: NormalizedEvent[]) {
    const install = this.installation();
    const device = this.device(envelope.device_id);
    if (!device) throw new Error("Unknown event device");
    const namespaceId = envelope.device_id === install.deviceId ? this.setting("active_team_id") ?? device.namespaceId : device.namespaceId;
    const traceId = records[0]?.traceId ?? `tr_${stableId(envelope.device_id, envelope.source, envelope.session_id ?? envelope.source_file)}`;
    const sessionId = envelope.session_id ?? envelope.project_key ?? stableId(envelope.source_file);
    const now = records[0]?.timestamp ?? envelope.timestamp;
    const titleCandidate = records.find((record) => record.kind === "user" && record.content)?.content ?? records.find((record) => record.content)?.content;
    const title = titleCandidate?.replace(/\s+/g, " ").slice(0, 100) || `${envelope.source} session`;
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`INSERT INTO traces(id,namespace_id,owner_id,source,session_id,title,visibility,started_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(
        traceId, namespaceId, device.principalId, envelope.source, sessionId, title,
        namespaceId === install.namespaceId ? this.setting("privacy.default") ?? "private" : this.setting(`team.policy.${namespaceId}.visibility`) ?? "private", now, now,
      );
      for (const record of records) {
        this.db.prepare(`INSERT OR IGNORE INTO events(id,trace_id,source_event_id,source,kind,role,content,tool_name,tool_call_id,command,model,timestamp,input_tokens,output_tokens,cost_usd,cost_accuracy,parser_version,source_file,file_type,metadata)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          record.id, traceId, record.sourceEventId, record.source, record.kind, record.role ?? null,
          record.content ?? null, record.toolName ?? null, record.toolCallId ?? null, record.command ?? null,
          record.model ?? null, record.timestamp, record.inputTokens ?? null, record.outputTokens ?? null,
          record.costUsd ?? null, record.costAccuracy ?? null, record.parserVersion, record.sourceFile,
          record.fileType, json(record.metadata),
        );
        if (record.repository || record.branch || record.pullRequest) {
          this.db.prepare("UPDATE traces SET repository=COALESCE(?,repository), branch=COALESCE(?,branch), pull_request=COALESCE(?,pull_request) WHERE id=?")
            .run(record.repository ?? null, record.branch ?? null, record.pullRequest ?? null, traceId);
        }
      }
      this.refreshTrace(traceId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private refreshTrace(traceId: string) {
    const rollup = this.db.prepare(`SELECT COUNT(*) AS event_count, COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens, SUM(cost_usd) AS cost_usd,
      MAX(CASE WHEN content IS NOT NULL AND content != '' THEN content END) AS summary, MAX(timestamp) AS updated_at
      FROM events WHERE trace_id=?`).get(traceId) as Row;
    const accuracy = rollup.cost_usd === null ? "unavailable" : "estimated";
    this.db.prepare("UPDATE traces SET event_count=?, input_tokens=?, output_tokens=?, cost_usd=?, cost_accuracy=?, summary=COALESCE(?,summary), updated_at=? WHERE id=?")
      .run(rollup.event_count as SQLInputValue, rollup.input_tokens as SQLInputValue, rollup.output_tokens as SQLInputValue,
        rollup.cost_usd as SQLInputValue, accuracy, text(rollup.summary)?.slice(0, 300) ?? null, rollup.updated_at as SQLInputValue, traceId);
  }

  listTraces(actor = this.actor(), options: { source?: SourceName; repository?: string; limit?: number } = {}): TraceSummary[] {
    const rows = this.db.prepare("SELECT * FROM traces ORDER BY updated_at DESC LIMIT ?").all(Math.min(options.limit ?? 50, 200)) as Row[];
    return rows.filter((row) => this.canAccess(row, actor)).filter((row) => !options.source || row.source === options.source)
      .filter((row) => !options.repository || row.repository === options.repository).map((row) => this.traceRow(row));
  }

  search(request: SearchRequest, actor = this.actor()): TraceSummary[] {
    const needle = `%${request.query.replaceAll("%", "").replaceAll("_", "")}%`;
    const rows = this.db.prepare(`SELECT DISTINCT t.* FROM traces t LEFT JOIN events e ON e.trace_id=t.id
      WHERE (t.title LIKE ? OR t.summary LIKE ? OR e.content LIKE ? OR e.tool_name LIKE ? OR t.repository LIKE ?)
      ORDER BY t.updated_at DESC LIMIT ?`).all(needle, needle, needle, needle, needle, Math.min((request.limit ?? 10) * 5, 200)) as Row[];
    return rows.filter((row) => this.canAccess(row, actor, request.scope))
      .filter((row) => !request.repository || row.repository === request.repository)
      .filter((row) => !request.source || row.source === request.source)
      .slice(0, request.limit ?? 10).map((row) => this.traceRow(row));
  }

  getTrace(traceId: string, actor = this.actor(), view: "metadata" | "summary" | "full_transcript" | "commands" | "files" | "usage" = "summary") {
    const row = this.db.prepare("SELECT * FROM traces WHERE id=?").get(traceId) as Row | undefined;
    if (!row || !this.canAccess(row, actor)) throw new Error("Trace not found or inaccessible");
    if (actor.shareToken) {
      const share = this.db.prepare("SELECT spec FROM shares WHERE token=? AND revoked_at IS NULL").get(actor.shareToken) as Row | undefined;
      const spec = parse<ShareSpec>(share?.spec, {} as ShareSpec);
      const allowed = spec.content === "full_transcript" || spec.content === "selected_messages"
        ? ["metadata", "summary", "full_transcript", "commands", "files", "usage"]
        : spec.content === "metadata" ? ["metadata"] : ["metadata", "summary", "usage"];
      if (!allowed.includes(view)) throw new Error("This share does not grant that trace view");
    }
    const trace = this.traceRow(row);
    if (view === "metadata" || view === "summary" || view === "usage") return trace;
    let clause = "";
    if (view === "commands") clause = " AND kind IN ('command','tool_call')";
    if (view === "files") clause = " AND kind='file'";
    const events = this.db.prepare(`SELECT * FROM events WHERE trace_id=?${clause} ORDER BY timestamp,id LIMIT 500`).all(traceId) as Row[];
    return { ...trace, events: events.map((eventRow) => ({ ...eventRow, metadata: parse(eventRow.metadata, {}) })), truncated: trace.eventCount > events.length };
  }

  current(actor = this.actor()) { return this.listTraces(actor, { limit: 1 })[0] ?? null; }

  setTraceVisibility(traceId: string, visibility: Visibility, actor = this.actor()) {
    const result = this.db.prepare("UPDATE traces SET visibility=? WHERE id=? AND owner_id=?").run(visibility, traceId, actor.principalId);
    if (!result.changes) throw new Error("Trace not found or not owned by this actor");
    this.audit(actor.principalId, "trace.visibility.update", "trace", traceId, { visibility });
    return { traceId, visibility };
  }

  usage(actor = this.actor(), options: { repository?: string; source?: SourceName } = {}) {
    const traces = this.listTraces(actor, { limit: 200 }).filter((trace) => !options.repository || trace.repository === options.repository)
      .filter((trace) => !options.source || trace.source === options.source);
    return {
      sessions: traces.length, inputTokens: traces.reduce((sum, trace) => sum + trace.inputTokens, 0),
      outputTokens: traces.reduce((sum, trace) => sum + trace.outputTokens, 0),
      costUsd: traces.reduce((sum, trace) => sum + (trace.costUsd ?? 0), 0),
      accuracy: traces.some((trace) => trace.costAccuracy === "estimated") ? "mixed" : "unavailable",
      bySource: Object.fromEntries([...new Set(traces.map((trace) => trace.source))].map((source) => [source, traces.filter((trace) => trace.source === source).length])),
    };
  }

  createShare(spec: ShareSpec, actor = this.actor()) {
    const trace = this.db.prepare("SELECT * FROM traces WHERE id=?").get(spec.traceId) as Row | undefined;
    if (!trace || trace.owner_id !== actor.principalId) throw new Error("Only the trace owner can share it");
    const shareId = id("share"); const token = randomBytes(18).toString("base64url");
    this.db.prepare("INSERT INTO shares VALUES (?,?,?,?,?,NULL,0,?)").run(shareId, token, spec.traceId, actor.principalId, json(spec), iso());
    this.audit(actor.principalId, "share.create", "share", shareId, spec);
    return { id: shareId, token, url: `/s/${token}`, ...spec };
  }

  prepareMutation(action: "share.create" | "skill.create", payload: unknown, actor = this.actor(), ttlSeconds = 300) {
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.db.prepare("INSERT INTO mutation_previews VALUES (?,?,?,?,?,NULL,?)").run(token, actor.principalId, action, json(payload), expiresAt, iso());
    return { confirmationToken: token, action, preview: payload, expiresAt, consequences: action === "share.create" ? "Creates a revocable permission capability for the exact audience and content shown." : "Creates a reusable skill containing the exact instructions and trace provenance shown." };
  }

  consumeMutation<T>(token: string, action: "share.create" | "skill.create", actor = this.actor()): T {
    const row = this.db.prepare("SELECT * FROM mutation_previews WHERE token=?").get(token) as Row | undefined;
    if (!row || row.actor_id !== actor.principalId || row.action !== action) throw new Error("Invalid confirmation token");
    if (row.consumed_at) throw new Error("Confirmation token has already been used");
    if (Date.parse(String(row.expires_at)) <= Date.now()) throw new Error("Confirmation token has expired");
    const result = this.db.prepare("UPDATE mutation_previews SET consumed_at=? WHERE token=? AND consumed_at IS NULL").run(iso(), token);
    if (!result.changes) throw new Error("Confirmation token has already been used");
    return parse<T>(row.payload, {} as T);
  }

  listShares(actor = this.actor()) {
    return (this.db.prepare("SELECT * FROM shares WHERE owner_id=? ORDER BY created_at DESC").all(actor.principalId) as Row[])
      .map((row) => ({ ...row, spec: parse(row.spec, {}) }));
  }

  revokeShare(shareId: string, actor = this.actor()) {
    const result = this.db.prepare("UPDATE shares SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL").run(iso(), shareId, actor.principalId);
    if (!result.changes) throw new Error("Share not found or already revoked");
    this.audit(actor.principalId, "share.revoke", "share", shareId, {});
    return { id: shareId, revoked: true };
  }

  actorForShare(token: string): Actor {
    const row = this.db.prepare("SELECT * FROM shares WHERE token=?").get(token) as Row | undefined;
    if (!row || row.revoked_at) throw new Error("Share not found or revoked");
    const spec = parse<ShareSpec>(row.spec, {} as ShareSpec);
    if (spec.expiresAt && Date.parse(spec.expiresAt) <= Date.now()) throw new Error("Share expired");
    if (spec.maxViews && Number(row.view_count) >= spec.maxViews) throw new Error("Share view limit reached");
    this.db.prepare("UPDATE shares SET view_count=view_count+1 WHERE id=?").run(row.id as SQLInputValue);
    return { principalId: "share-viewer", teamIds: [], shareToken: token };
  }

  createSkill(input: { name: string; description: string; instructions: string[]; validation?: string[]; traceIds: string[]; visibility?: Visibility; namespaceId?: string }, actor = this.actor()) {
    for (const traceId of input.traceIds) this.getTrace(traceId, actor, "summary");
    const skillId = id("skill"); const namespaceId = input.namespaceId ?? this.installation().namespaceId;
    this.db.prepare("INSERT INTO skills VALUES (?,?,?,?,?,?,?,?,?,NULL,?)").run(
      skillId, namespaceId, actor.principalId, input.name, input.description, json(input.instructions), json(input.validation ?? []),
      json(input.traceIds), input.visibility ?? "private", iso(),
    );
    this.audit(actor.principalId, "skill.create", "skill", skillId, { name: input.name });
    return this.getSkill(skillId, actor);
  }

  listSkills(actor = this.actor(), query = "") {
    const rows = this.db.prepare("SELECT * FROM skills WHERE archived_at IS NULL AND (name LIKE ? OR description LIKE ?) ORDER BY created_at DESC").all(`%${query}%`, `%${query}%`) as Row[];
    return rows.filter((row) => row.owner_id === actor.principalId || actor.teamIds.includes(String(row.namespace_id)) || row.visibility === "public").map((row) => this.skillRow(row));
  }

  getSkill(skillId: string, actor = this.actor()) {
    const row = this.db.prepare("SELECT * FROM skills WHERE id=? AND archived_at IS NULL").get(skillId) as Row | undefined;
    if (!row || !(row.owner_id === actor.principalId || actor.teamIds.includes(String(row.namespace_id)) || row.visibility === "public")) throw new Error("Skill not found or inaccessible");
    return this.skillRow(row);
  }

  archiveSkill(skillId: string, actor = this.actor()) {
    const result = this.db.prepare("UPDATE skills SET archived_at=? WHERE id=? AND owner_id=? AND archived_at IS NULL").run(iso(), skillId, actor.principalId);
    if (!result.changes) throw new Error("Skill not found");
    return { id: skillId, archived: true };
  }

  cursor(source: SourceName, key: string) { return (this.db.prepare("SELECT value FROM cursors WHERE source=? AND key=?").get(source, key) as Row | undefined)?.value as string | undefined; }
  setCursor(source: SourceName, key: string, value: string) { this.db.prepare("INSERT INTO cursors VALUES (?,?,?,?) ON CONFLICT(source,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(source, key, value, iso()); }
  spoolStatus() { return this.db.prepare("SELECT state, COUNT(*) AS count FROM spool GROUP BY state ORDER BY state").all(); }
  auditLog(actor = this.actor()) { return this.db.prepare("SELECT * FROM audit WHERE actor_id=? ORDER BY created_at DESC").all(actor.principalId); }

  private canAccess(row: Row, actor: Actor, scope?: SearchRequest["scope"]) {
    const own = row.owner_id === actor.principalId;
    const team = actor.teamIds.includes(String(row.namespace_id)) && row.visibility === "team";
    const publicAccess = row.visibility === "public";
    let shared = false;
    if (actor.shareToken) {
      const share = this.db.prepare("SELECT trace_id FROM shares WHERE token=? AND revoked_at IS NULL").get(actor.shareToken) as Row | undefined;
      shared = share?.trace_id === row.id;
    }
    if (scope === "mine") return own;
    if (scope === "team") return team;
    if (scope === "shared_with_me") return shared;
    return own || team || publicAccess || shared;
  }

  private traceRow(row: Row): TraceSummary {
    return {
      id: String(row.id), namespaceId: String(row.namespace_id), ownerId: String(row.owner_id), source: row.source as SourceName,
      sessionId: String(row.session_id), title: String(row.title), summary: String(row.summary ?? ""),
      repository: row.repository ? String(row.repository) : undefined, branch: row.branch ? String(row.branch) : undefined,
      pullRequest: row.pull_request === null ? undefined : Number(row.pull_request), visibility: row.visibility as Visibility,
      startedAt: String(row.started_at), updatedAt: String(row.updated_at), eventCount: Number(row.event_count),
      inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), costUsd: row.cost_usd === null ? undefined : Number(row.cost_usd),
      costAccuracy: row.cost_accuracy as TraceSummary["costAccuracy"],
    };
  }

  private skillRow(row: Row) {
    return { id: row.id, namespaceId: row.namespace_id, ownerId: row.owner_id, name: row.name, description: row.description,
      instructions: parse(row.instructions, []), validation: parse(row.validation, []), sourceTraceIds: parse(row.source_trace_ids, []),
      visibility: row.visibility, createdAt: row.created_at };
  }

  private audit(actorId: string, action: string, resourceType: string, resourceId: string, details: unknown) {
    this.db.prepare("INSERT INTO audit VALUES (?,?,?,?,?,?,?)").run(id("audit"), actorId, action, resourceType, resourceId, json(details), iso());
  }
}

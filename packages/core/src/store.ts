import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Actor, IngestReceipt, LinkEvidence, MembershipRole, NativeEnvelope, NormalizedEvent, PullRequestRef,
  SearchRequest, SetupLinkSpec, ShareSpec, SourceName, TraceEnrichment, TraceSummary, Visibility,
} from "./contracts.js";
import { assertNativeEnvelope } from "./contracts.js";
import { LocalCrypto } from "./crypto.js";
import { ParserRegistry } from "./parsers/index.js";
import { stableId, text } from "./parsers/base.js";
import { scrubRecord } from "./redaction.js";
import { sharePath, shareToken } from "./sharing.js";

type Row = Record<string, unknown>;

function json(value: unknown) { return JSON.stringify(value ?? null); }
function parse<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function iso() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}_${randomBytes(9).toString("base64url")}`; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function validEmail(value: string) {
  if (value.length < 3 || value.length > 254 || [...value].some((character) => character.trim() === "")) return false;
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 3 && value.indexOf(".", at + 2) > at + 1 && !value.endsWith(".");
}

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
      CREATE TABLE IF NOT EXISTS setup_links (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, namespace_id TEXT NOT NULL, created_by TEXT NOT NULL,
        email TEXT, domain TEXT, max_uses INTEGER, uses_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT,
        revoked_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS team_repositories (
        namespace_id TEXT NOT NULL, repository TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(namespace_id, repository)
      );
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY, canonical_name TEXT UNIQUE NOT NULL, provider TEXT NOT NULL DEFAULT 'github', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS git_commits (
        repository_id TEXT NOT NULL, sha TEXT NOT NULL, branch TEXT, author_email TEXT, committed_at TEXT,
        PRIMARY KEY(repository_id, sha)
      );
      CREATE TABLE IF NOT EXISTS pull_requests (
        id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT, state TEXT, url TEXT,
        head_sha TEXT, base_sha TEXT, author_login TEXT, updated_at TEXT NOT NULL,
        UNIQUE(repository_id, number)
      );
      CREATE TABLE IF NOT EXISTS trace_commits (
        trace_id TEXT NOT NULL, repository_id TEXT NOT NULL, commit_sha TEXT NOT NULL, evidence TEXT NOT NULL,
        confidence REAL NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(trace_id, repository_id, commit_sha)
      );
      CREATE TABLE IF NOT EXISTS trace_pull_requests (
        trace_id TEXT NOT NULL, pull_request_id TEXT NOT NULL, evidence TEXT NOT NULL, confidence REAL NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(trace_id, pull_request_id)
      );
      CREATE TABLE IF NOT EXISTS trace_enrichments (
        trace_id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, stages TEXT NOT NULL, outcome TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT, prompt_version TEXT NOT NULL, generated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS share_snapshots (
        share_id TEXT PRIMARY KEY, view TEXT NOT NULL, payload TEXT NOT NULL, source_updated_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS share_access (
        id TEXT PRIMARY KEY, share_id TEXT NOT NULL, viewer_hash TEXT, viewed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS github_installations (
        id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, github_installation_id TEXT UNIQUE NOT NULL,
        account_login TEXT NOT NULL, permissions TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("events", "operation_kind", "TEXT");
    this.ensureColumn("events", "operation_status", "TEXT");
    this.ensureColumn("events", "purpose", "TEXT");
    this.ensureColumn("events", "parent_event_id", "TEXT");
    this.ensureColumn("events", "child_trace_id", "TEXT");
    this.ensureColumn("events", "duration_ms", "INTEGER");
    this.ensureColumn("events", "input", "TEXT");
    this.ensureColumn("events", "output", "TEXT");
    this.ensureColumn("traces", "enrichment_status", "TEXT NOT NULL DEFAULT 'pending'");
  }

  private ensureColumn(table: string, column: string, declaration: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((row) => row.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
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
    const teams = this.db.prepare("SELECT namespace_id,role FROM memberships WHERE principal_id=? AND namespace_id != ?").all(installation.principalId, installation.namespaceId) as Row[];
    return {
      principalId: installation.principalId,
      teamIds: teams.map((row) => String(row.namespace_id)),
      teamRoles: Object.fromEntries(teams.map((row) => [String(row.namespace_id), String(row.role) as MembershipRole])),
      role: "owner",
    };
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
    this.db.prepare("INSERT INTO namespaces VALUES (?, 'team', ?, ?, 'private', ?)").run(teamId, principalId, slug, iso());
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

  createSetupLink(teamId: string, options: Omit<SetupLinkSpec, "teamId"> = {}, actor = this.actor()) {
    this.requireTeamAdmin(teamId, actor);
    if (options.maxUses !== undefined && (!Number.isInteger(options.maxUses) || options.maxUses < 1 || options.maxUses > 10_000)) {
      throw new Error("Setup link maxUses must be between 1 and 10000");
    }
    if (options.expiresAt && Date.parse(options.expiresAt) <= Date.now()) throw new Error("Setup link expiry must be in the future");
    if (options.email && !validEmail(options.email)) throw new Error("Invalid setup link email");
    if (options.domain && !/^[a-z0-9.-]+$/i.test(options.domain)) throw new Error("Invalid setup link domain");
    const setupLinkId = id("setup");
    const token = randomBytes(24).toString("base64url");
    const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
    this.db.prepare(`INSERT INTO setup_links(id,token_hash,namespace_id,created_by,email,domain,max_uses,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      setupLinkId, hash(token), teamId, actor.principalId, options.email?.toLowerCase() ?? null,
      options.domain?.toLowerCase() ?? null, options.maxUses ?? 50, expiresAt, iso(),
    );
    this.audit(actor.principalId, "setup_link.create", "setup_link", setupLinkId, { teamId, ...options, expiresAt });
    return { id: setupLinkId, token, url: `/join/${token}`, teamId, expiresAt, maxUses: options.maxUses ?? 50 };
  }

  listSetupLinks(teamId: string, actor = this.actor()) {
    this.requireTeamAdmin(teamId, actor);
    return (this.db.prepare(`SELECT id,namespace_id,email,domain,max_uses,uses_count,expires_at,revoked_at,created_at
      FROM setup_links WHERE namespace_id=? ORDER BY created_at DESC`).all(teamId) as Row[]).map((row) => ({
      id: String(row.id), teamId: String(row.namespace_id), email: row.email ? String(row.email) : undefined,
      domain: row.domain ? String(row.domain) : undefined, maxUses: row.max_uses === null ? undefined : Number(row.max_uses),
      uses: Number(row.uses_count), expiresAt: row.expires_at ? String(row.expires_at) : undefined,
      revokedAt: row.revoked_at ? String(row.revoked_at) : undefined, createdAt: String(row.created_at),
    }));
  }

  revokeSetupLink(setupLinkId: string, actor = this.actor()) {
    const row = this.db.prepare("SELECT namespace_id FROM setup_links WHERE id=?").get(setupLinkId) as Row | undefined;
    if (!row) throw new Error("Setup link not found");
    this.requireTeamAdmin(String(row.namespace_id), actor);
    const result = this.db.prepare("UPDATE setup_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(iso(), setupLinkId);
    if (!result.changes) throw new Error("Setup link is already revoked");
    this.audit(actor.principalId, "setup_link.revoke", "setup_link", setupLinkId, {});
    return { id: setupLinkId, revoked: true };
  }

  redeemSetupLink(token: string, suppliedEmail?: string) {
    const row = this.db.prepare("SELECT * FROM setup_links WHERE token_hash=?").get(hash(token)) as Row | undefined;
    if (!row || row.revoked_at) throw new Error("Setup link not found or revoked");
    if (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now()) throw new Error("Setup link expired");
    if (row.max_uses !== null && Number(row.uses_count) >= Number(row.max_uses)) throw new Error("Setup link usage limit reached");
    const principalId = this.installation().principalId;
    const principal = this.db.prepare("SELECT email FROM principals WHERE id=?").get(principalId) as Row | undefined;
    const email = String(suppliedEmail ?? principal?.email ?? "").toLowerCase();
    if (row.email && email !== String(row.email)) throw new Error("Setup link is bound to another email");
    if (row.domain && email.split("@")[1] !== String(row.domain)) throw new Error("Setup link requires an approved email domain");
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO memberships VALUES (?,?, 'member') ON CONFLICT(principal_id,namespace_id) DO NOTHING").run(principalId, row.namespace_id as SQLInputValue);
      this.db.prepare("UPDATE setup_links SET uses_count=uses_count+1 WHERE id=?").run(row.id as SQLInputValue);
      this.setSetting("active_team_id", String(row.namespace_id));
      this.audit(principalId, "setup_link.redeem", "setup_link", String(row.id), { teamId: row.namespace_id });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { teamId: String(row.namespace_id), principalId, role: "member" as const, deviceId: this.installation().deviceId };
  }

  addTeamRepository(teamId: string, repository: string, actor = this.actor()) {
    this.requireTeamAdmin(teamId, actor);
    const canonical = repository.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(canonical)) throw new Error("Team repository must be a canonical GitHub repository URL");
    this.db.prepare("INSERT INTO team_repositories VALUES (?,?,?,?) ON CONFLICT(namespace_id,repository) DO NOTHING")
      .run(teamId, canonical, actor.principalId, iso());
    this.audit(actor.principalId, "team_repository.add", "repository", canonical, { teamId });
    return { teamId, repository: canonical };
  }

  listTeamRepositories(teamId: string, actor = this.actor()) {
    if (!actor.teamIds.includes(teamId)) throw new Error("Team not found or inaccessible");
    return this.db.prepare("SELECT repository,created_at FROM team_repositories WHERE namespace_id=? ORDER BY repository").all(teamId);
  }

  listTeamDevices(teamId: string, actor = this.actor()) {
    this.requireTeamAdmin(teamId, actor);
    return this.db.prepare(`SELECT d.id,d.name,d.claimed,d.created_at,p.email,p.name principal_name,m.role
      FROM memberships m JOIN devices d ON d.principal_id=m.principal_id JOIN principals p ON p.id=d.principal_id
      WHERE m.namespace_id=? ORDER BY d.created_at DESC`).all(teamId);
  }

  enqueue(batchId: string, envelopes: NativeEnvelope[], expectedDeviceId = this.installation().deviceId): IngestReceipt {
    const device = this.device(expectedDeviceId);
    if (!device) throw new Error("Unknown device");
    const incomingBytes = Buffer.byteLength(json(envelopes));
    const quotaBytes = Number(this.setting("spool.max_bytes") ?? 512 * 1024 * 1024);
    const used = this.db.prepare("SELECT COALESCE(SUM(length(cipher)+length(nonce)+length(tag)),0) AS bytes FROM spool WHERE state!='processed'").get() as Row;
    if (Number(used.bytes) + incomingBytes > quotaBytes) throw new Error(`Local spool quota exceeded (${quotaBytes} bytes); upload or raise spool.max_bytes explicitly`);
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
    this.db.prepare("DELETE FROM spool WHERE state='processed' AND processed_at < datetime('now','-7 days')").run();
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
        this.db.prepare(`INSERT OR IGNORE INTO events(id,trace_id,source_event_id,source,kind,role,content,tool_name,tool_call_id,command,model,timestamp,input_tokens,output_tokens,cost_usd,cost_accuracy,parser_version,source_file,file_type,metadata,operation_kind,operation_status,purpose,parent_event_id,child_trace_id,duration_ms,input,output)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          record.id, traceId, record.sourceEventId, record.source, record.kind, record.role ?? null,
          record.content ?? null, record.toolName ?? null, record.toolCallId ?? null, record.command ?? null,
          record.model ?? null, record.timestamp, record.inputTokens ?? null, record.outputTokens ?? null,
          record.costUsd ?? null, record.costAccuracy ?? null, record.parserVersion, record.sourceFile,
          record.fileType, json(record.metadata), record.operationKind ?? null, record.operationStatus ?? null,
          record.purpose ?? null, record.parentEventId ?? null, record.childTraceId ?? null, record.durationMs ?? null,
          record.input ? json(record.input) : null, record.output ? json(record.output) : null,
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
      MAX(CASE WHEN cost_accuracy='exact' THEN 1 ELSE 0 END) AS has_exact,
      MAX(CASE WHEN cost_accuracy='estimated' THEN 1 ELSE 0 END) AS has_estimated,
      MAX(CASE WHEN cost_accuracy='subscription_included' THEN 1 ELSE 0 END) AS has_subscription,
      MAX(CASE WHEN content IS NOT NULL AND content != '' THEN content END) AS summary, MAX(timestamp) AS updated_at
      FROM events WHERE trace_id=?`).get(traceId) as Row;
    const accuracy = Number(rollup.has_exact) ? "exact" : Number(rollup.has_estimated) ? "estimated" : Number(rollup.has_subscription) ? "subscription_included" : "unavailable";
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
    if (actor.shareToken) return this.getShareSnapshot(actor.shareToken, traceId, view);
    const row = this.db.prepare("SELECT * FROM traces WHERE id=?").get(traceId) as Row | undefined;
    if (!row || !this.canAccess(row, actor)) throw new Error("Trace not found or inaccessible");
    const trace = this.traceRow(row);
    if (view === "metadata" || view === "summary" || view === "usage") return trace;
    let clause = "";
    if (view === "commands") clause = " AND kind IN ('command','tool_call')";
    if (view === "files") clause = " AND kind='file'";
    const events = this.db.prepare(`SELECT * FROM events WHERE trace_id=?${clause} ORDER BY timestamp,id LIMIT 500`).all(traceId) as Row[];
    return {
      ...trace,
      events: events.map((eventRow) => ({
        ...eventRow,
        metadata: parse(eventRow.metadata, {}),
        input: parse(eventRow.input, undefined),
        output: parse(eventRow.output, undefined),
      })),
      truncated: trace.eventCount > events.length,
    };
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

  prepareTraceEnrichment(traceId: string, actor = this.actor()) {
    const trace = this.getTrace(traceId, actor, "full_transcript") as TraceSummary & { events: Row[] };
    const meaningful = trace.events.filter((event) => ["user", "assistant", "tool_call", "tool_result", "error"].includes(String(event.kind))).slice(0, 80);
    return {
      traceId,
      currentTitle: trace.title,
      currentSummary: trace.summary,
      repository: trace.repository,
      source: trace.source,
      promptVersion: "trace-summary-v1",
      events: meaningful.map((event) => ({
        id: String(event.id), kind: String(event.kind), role: event.role ? String(event.role) : undefined,
        operationKind: event.operation_kind ? String(event.operation_kind) : undefined,
        text: String(event.content ?? event.command ?? event.tool_name ?? "").slice(0, 2_000),
      })),
    };
  }

  cacheTraceEnrichment(input: Omit<TraceEnrichment, "generatedAt"> & { generatedAt?: string }, actor = this.actor()) {
    const trace = this.db.prepare("SELECT owner_id,namespace_id FROM traces WHERE id=?").get(input.traceId) as Row | undefined;
    if (!trace || !(trace.owner_id === actor.principalId || actor.teamIds.includes(String(trace.namespace_id)))) throw new Error("Trace not found or inaccessible");
    if (!input.title.trim() || !input.summary.trim()) throw new Error("Trace enrichment requires a title and summary");
    const generatedAt = input.generatedAt ?? iso();
    this.db.prepare(`INSERT INTO trace_enrichments(trace_id,title,summary,stages,outcome,provider,model,prompt_version,generated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(trace_id) DO UPDATE SET title=excluded.title,summary=excluded.summary,
      stages=excluded.stages,outcome=excluded.outcome,provider=excluded.provider,model=excluded.model,
      prompt_version=excluded.prompt_version,generated_at=excluded.generated_at`).run(
      input.traceId, input.title.slice(0, 160), input.summary.slice(0, 2_000), json(input.stages.slice(0, 8)),
      input.outcome, input.provider, input.model ?? null, input.promptVersion, generatedAt,
    );
    this.db.prepare("UPDATE traces SET title=?,summary=?,enrichment_status='ready' WHERE id=?")
      .run(input.title.slice(0, 160), input.summary.slice(0, 2_000), input.traceId);
    this.audit(actor.principalId, "trace.enrichment.cache", "trace", input.traceId, { provider: input.provider, model: input.model });
    return this.getTraceEnrichment(input.traceId, actor);
  }

  getTraceEnrichment(traceId: string, actor = this.actor()): TraceEnrichment | null {
    this.getTrace(traceId, actor, "metadata");
    const row = this.db.prepare("SELECT * FROM trace_enrichments WHERE trace_id=?").get(traceId) as Row | undefined;
    if (!row) return null;
    return {
      traceId, title: String(row.title), summary: String(row.summary), stages: parse(row.stages, []),
      outcome: String(row.outcome) as TraceEnrichment["outcome"], provider: String(row.provider) as TraceEnrichment["provider"],
      model: row.model ? String(row.model) : undefined, promptVersion: String(row.prompt_version), generatedAt: String(row.generated_at),
    };
  }

  linkTraceToCommit(traceId: string, repository: string, sha: string, evidence: LinkEvidence = "exact_commit", confidence = 1, actor = this.actor()) {
    this.getTrace(traceId, actor, "metadata");
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error("Invalid commit SHA");
    const repositoryId = this.ensureRepository(repository);
    this.db.prepare("INSERT INTO git_commits(repository_id,sha) VALUES(?,?) ON CONFLICT(repository_id,sha) DO NOTHING").run(repositoryId, sha.toLowerCase());
    this.db.prepare(`INSERT INTO trace_commits(trace_id,repository_id,commit_sha,evidence,confidence,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(trace_id,repository_id,commit_sha) DO UPDATE SET evidence=excluded.evidence,confidence=excluded.confidence`)
      .run(traceId, repositoryId, sha.toLowerCase(), evidence, this.validConfidence(confidence), iso());
    return { traceId, repository, sha: sha.toLowerCase(), evidence, confidence };
  }

  upsertPullRequest(input: { repository: string; number: number; title?: string; state?: string; url?: string; headSha?: string; baseSha?: string; authorLogin?: string }) {
    if (!Number.isInteger(input.number) || input.number < 1) throw new Error("Invalid pull request number");
    const repositoryId = this.ensureRepository(input.repository);
    const pullRequestId = `pr_${stableId(repositoryId, input.number)}`;
    this.db.prepare(`INSERT INTO pull_requests(id,repository_id,number,title,state,url,head_sha,base_sha,author_login,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(repository_id,number) DO UPDATE SET title=excluded.title,state=excluded.state,
      url=excluded.url,head_sha=excluded.head_sha,base_sha=excluded.base_sha,author_login=excluded.author_login,updated_at=excluded.updated_at`).run(
      pullRequestId, repositoryId, input.number, input.title ?? null, input.state ?? null, input.url ?? null,
      input.headSha ?? null, input.baseSha ?? null, input.authorLogin ?? null, iso(),
    );
    return { id: pullRequestId, ...input };
  }

  linkTraceToPullRequest(traceId: string, input: {
    repository: string; number: number; title?: string; state?: string; url?: string; headSha?: string; baseSha?: string; authorLogin?: string;
    evidence?: LinkEvidence; confidence?: number; confirmed?: boolean;
  }, actor = this.actor()) {
    this.getTrace(traceId, actor, "metadata");
    const pullRequest = this.upsertPullRequest(input);
    const evidence = input.evidence ?? "manual";
    const confidence = this.validConfidence(input.confidence ?? (evidence === "manual" || evidence === "exact_commit" ? 1 : 0.75));
    this.db.prepare(`INSERT INTO trace_pull_requests(trace_id,pull_request_id,evidence,confidence,confirmed,created_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(trace_id,pull_request_id) DO UPDATE SET evidence=excluded.evidence,
      confidence=excluded.confidence,confirmed=excluded.confirmed`).run(traceId, pullRequest.id, evidence, confidence, input.confirmed ? 1 : 0, iso());
    this.audit(actor.principalId, "trace.pull_request.link", "trace", traceId, { pullRequestId: pullRequest.id, evidence, confidence });
    return { traceId, pullRequestId: pullRequest.id, repository: input.repository, number: input.number, evidence, confidence, confirmed: Boolean(input.confirmed) };
  }

  getPullRequestTrace(repository: string, number: number, actor = this.actor()) {
    const canonical = repository.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
    const row = this.db.prepare(`SELECT pr.*,r.canonical_name repository FROM pull_requests pr
      JOIN repositories r ON r.id=pr.repository_id WHERE r.canonical_name=? AND pr.number=?`).get(canonical, number) as Row | undefined;
    const traces = row ? (this.db.prepare(`SELECT t.* FROM traces t JOIN trace_pull_requests l ON l.trace_id=t.id
      WHERE l.pull_request_id=? ORDER BY t.updated_at DESC`).all(row.id as SQLInputValue) as Row[])
      .filter((trace) => this.canAccess(trace, actor)).map((trace) => this.traceRow(trace)) : [];
    return {
      pullRequest: row ? { id: row.id, repository: row.repository, number: Number(row.number), title: row.title, state: row.state, url: row.url, headSha: row.head_sha, baseSha: row.base_sha } : null,
      traces,
      usage: {
        inputTokens: traces.reduce((sum, trace) => sum + trace.inputTokens, 0),
        outputTokens: traces.reduce((sum, trace) => sum + trace.outputTokens, 0),
        costUsd: traces.reduce((sum, trace) => sum + (trace.costUsd ?? 0), 0),
        accuracy: traces.some((trace) => trace.costAccuracy === "exact") ? "mixed_or_exact" : traces.some((trace) => trace.costAccuracy === "estimated") ? "estimated" : traces.some((trace) => trace.costAccuracy === "subscription_included") ? "subscription_included" : "unavailable",
      },
    };
  }

  createShare(spec: ShareSpec, actor = this.actor()) {
    const trace = this.db.prepare("SELECT t.*,COALESCE(e.title,t.title) share_title FROM traces t LEFT JOIN trace_enrichments e ON e.trace_id=t.id WHERE t.id=?").get(spec.traceId) as Row | undefined;
    if (!trace || trace.owner_id !== actor.principalId) throw new Error("Only the trace owner can share it");
    const shareId = id("share"); const token = randomBytes(18).toString("base64url");
    const normalizedSpec = { ...spec, live: spec.live === true };
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO shares VALUES (?,?,?,?,?,NULL,0,?)").run(shareId, token, spec.traceId, actor.principalId, json(normalizedSpec), iso());
      if (!normalizedSpec.live) {
        const view = this.normalizeShareView(spec.content);
        const payload = this.buildShareSnapshot(spec.traceId, view, spec.selectedEventIds);
        this.db.prepare("INSERT INTO share_snapshots VALUES (?,?,?,?,?)").run(shareId, view, json(payload), trace.updated_at as SQLInputValue, iso());
      }
      this.audit(actor.principalId, "share.create", "share", shareId, normalizedSpec);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { id: shareId, token, url: sharePath(String(trace.share_title), token), snapshot: !normalizedSpec.live, ...normalizedSpec };
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

  actorForShare(pathSegment: string): Actor {
    const token = shareToken(pathSegment);
    const row = this.db.prepare("SELECT * FROM shares WHERE token=?").get(token) as Row | undefined;
    if (!row || row.revoked_at) throw new Error("Share not found or revoked");
    const spec = parse<ShareSpec>(row.spec, {} as ShareSpec);
    if (spec.expiresAt && Date.parse(spec.expiresAt) <= Date.now()) throw new Error("Share expired");
    if (spec.maxViews && Number(row.view_count) >= spec.maxViews) throw new Error("Share view limit reached");
    this.db.prepare("UPDATE shares SET view_count=view_count+1 WHERE id=?").run(row.id as SQLInputValue);
    this.db.prepare("INSERT INTO share_access VALUES (?,?,NULL,?)").run(id("access"), row.id as SQLInputValue, iso());
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
    const teamRole = actor.teamRoles?.[String(row.namespace_id)];
    const managedRepository = Boolean(row.repository && this.db.prepare("SELECT 1 FROM team_repositories WHERE namespace_id=? AND repository=?")
      .get(row.namespace_id as SQLInputValue, row.repository as SQLInputValue));
    const teamAdmin = managedRepository && (teamRole === "owner" || teamRole === "admin");
    const publicAccess = row.visibility === "public";
    let shared = false;
    if (actor.shareToken) {
      const share = this.db.prepare("SELECT trace_id FROM shares WHERE token=? AND revoked_at IS NULL").get(actor.shareToken) as Row | undefined;
      shared = share?.trace_id === row.id;
    }
    if (scope === "mine") return own;
    if (scope === "team") return team || teamAdmin;
    if (scope === "shared_with_me") return shared;
    return own || team || teamAdmin || publicAccess || shared;
  }

  private traceRow(row: Row): TraceSummary {
    const pullRequests = this.pullRequestsForTrace(String(row.id));
    return {
      id: String(row.id), namespaceId: String(row.namespace_id), ownerId: String(row.owner_id), source: row.source as SourceName,
      sessionId: String(row.session_id), title: String(row.title), summary: String(row.summary ?? ""),
      repository: row.repository ? String(row.repository) : undefined, branch: row.branch ? String(row.branch) : undefined,
      pullRequest: row.pull_request === null ? undefined : Number(row.pull_request), visibility: row.visibility as Visibility,
      pullRequests,
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

  private requireTeamAdmin(teamId: string, actor: Actor) {
    const role = actor.teamRoles?.[teamId] ?? (this.db.prepare("SELECT role FROM memberships WHERE principal_id=? AND namespace_id=?")
      .get(actor.principalId, teamId) as Row | undefined)?.role;
    if (role !== "owner" && role !== "admin") throw new Error("Only a team owner or admin can perform this action");
  }

  private ensureRepository(repository: string) {
    const canonical = repository.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(canonical)) throw new Error("Repository must be a canonical GitHub URL");
    const repositoryId = `repo_${stableId(canonical.toLowerCase())}`;
    this.db.prepare("INSERT INTO repositories(id,canonical_name,created_at) VALUES(?,?,?) ON CONFLICT(canonical_name) DO NOTHING")
      .run(repositoryId, canonical, iso());
    return repositoryId;
  }

  private validConfidence(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Link confidence must be between 0 and 1");
    return value;
  }

  private pullRequestsForTrace(traceId: string): PullRequestRef[] {
    return (this.db.prepare(`SELECT pr.id,r.canonical_name repository,pr.number,pr.title,pr.state,pr.url,
      l.evidence,l.confidence,l.confirmed FROM trace_pull_requests l JOIN pull_requests pr ON pr.id=l.pull_request_id
      JOIN repositories r ON r.id=pr.repository_id WHERE l.trace_id=? ORDER BY pr.number`).all(traceId) as Row[]).map((row) => ({
      id: String(row.id), repository: String(row.repository), number: Number(row.number),
      title: row.title ? String(row.title) : undefined, state: row.state ? String(row.state) : undefined,
      url: row.url ? String(row.url) : undefined, evidence: String(row.evidence) as LinkEvidence,
      confidence: Number(row.confidence), confirmed: Boolean(row.confirmed),
    }));
  }

  private normalizeShareView(content: ShareSpec["content"]): "overview" | "conversation" | "highlights" | "full_trace" {
    if (content === "full_transcript") return "full_trace";
    if (content === "selected_messages") return "highlights";
    if (content === "metadata" || content === "summary" || content === "skill") return "overview";
    return content;
  }

  private buildShareSnapshot(traceId: string, view: "overview" | "conversation" | "highlights" | "full_trace", selectedEventIds?: string[]) {
    const traceRow = this.db.prepare("SELECT * FROM traces WHERE id=?").get(traceId) as Row | undefined;
    if (!traceRow) throw new Error("Trace not found");
    const trace = this.traceRow(traceRow);
    const allEvents = this.db.prepare("SELECT * FROM events WHERE trace_id=? ORDER BY timestamp,id LIMIT 500").all(traceId) as Row[];
    const selected = new Set(selectedEventIds ?? []);
    const eventRows = view === "overview"
      ? allEvents.filter((event) => ["user", "assistant", "error"].includes(String(event.kind))).slice(0, 12)
      : view === "conversation"
        ? allEvents.filter((event) => ["user", "assistant"].includes(String(event.kind)))
        : view === "highlights"
          ? allEvents.filter((event) => selected.size ? selected.has(String(event.id)) : ["user", "assistant", "error"].includes(String(event.kind))).slice(0, 100)
          : allEvents;
    return {
      snapshotVersion: 1,
      view,
      trace,
      enrichment: this.getTraceEnrichmentWithoutAuthorization(traceId),
      events: eventRows.map((event) => ({
        id: event.id, kind: event.kind, role: event.role, content: event.content, toolName: event.tool_name,
        toolCallId: event.tool_call_id, command: event.command, model: event.model, timestamp: event.timestamp,
        operationKind: event.operation_kind, operationStatus: event.operation_status, purpose: event.purpose,
        parentEventId: event.parent_event_id, childTraceId: event.child_trace_id, durationMs: event.duration_ms,
        input: parse(event.input, undefined), output: parse(event.output, undefined),
      })),
      truncated: eventRows.length < allEvents.length,
    };
  }

  private getTraceEnrichmentWithoutAuthorization(traceId: string): TraceEnrichment | null {
    const row = this.db.prepare("SELECT * FROM trace_enrichments WHERE trace_id=?").get(traceId) as Row | undefined;
    if (!row) return null;
    return {
      traceId, title: String(row.title), summary: String(row.summary), stages: parse(row.stages, []),
      outcome: String(row.outcome) as TraceEnrichment["outcome"], provider: String(row.provider) as TraceEnrichment["provider"],
      model: row.model ? String(row.model) : undefined, promptVersion: String(row.prompt_version), generatedAt: String(row.generated_at),
    };
  }

  private getShareSnapshot(token: string, traceId: string, requestedView: "metadata" | "summary" | "full_transcript" | "commands" | "files" | "usage") {
    const share = this.db.prepare("SELECT * FROM shares WHERE token=? AND revoked_at IS NULL").get(token) as Row | undefined;
    if (!share || share.trace_id !== traceId) throw new Error("Share not found, revoked, or inaccessible");
    const spec = parse<ShareSpec>(share.spec, {} as ShareSpec);
    if (spec.expiresAt && Date.parse(spec.expiresAt) <= Date.now()) throw new Error("Share expired");
    const snapshot = this.db.prepare("SELECT payload FROM share_snapshots WHERE share_id=?").get(share.id as SQLInputValue) as Row | undefined;
    const payload = snapshot ? parse<Record<string, unknown>>(snapshot.payload, {}) : this.buildShareSnapshot(traceId, this.normalizeShareView(spec.content), spec.selectedEventIds);
    if (["metadata", "summary", "usage"].includes(requestedView)) return { ...(payload.trace as object), enrichment: payload.enrichment, snapshot: !spec.live };
    if (this.normalizeShareView(spec.content) === "overview") throw new Error("This share does not grant transcript access");
    if (requestedView === "commands") return { ...payload, events: (payload.events as Row[]).filter((event) => event.operationKind === "command_run" || event.kind === "command") };
    if (requestedView === "files") return { ...payload, events: (payload.events as Row[]).filter((event) => String(event.operationKind ?? "").startsWith("file_")) };
    return { ...payload, snapshot: !spec.live };
  }
}

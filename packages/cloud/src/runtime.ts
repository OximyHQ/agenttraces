import { createHash, randomBytes } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool, type PoolClient } from "pg";
import {
  ParserRegistry, assertNativeEnvelope, stableId, type NativeEnvelope, type NormalizedEvent,
  sharePath, shareToken, type LinkEvidence, type SearchRequest, type ShareSpec, type TraceEnrichment,
} from "@agenttraces/core";
import type { CloudConfig } from "./config.js";
import { CLOUD_SCHEMA } from "./schema.js";

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function validEmail(value: string) {
  if (value.length < 3 || value.length > 254 || [...value].some((character) => character.trim() === "")) return false;
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 3 && value.indexOf(".", at + 2) > at + 1 && !value.endsWith(".");
}
function opaque(prefix: string) { return `${prefix}_${randomBytes(18).toString("base64url")}`; }
function redisConnection(url: string) { const parsed = new URL(url); return { host: parsed.hostname, port: Number(parsed.port || 6379), username: parsed.username || undefined, password: parsed.password || undefined, tls: parsed.protocol === "rediss:" ? {} : undefined }; }
function canonicalRepository(value: string) {
  const canonical = value.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(canonical)) throw new Error("Invalid GitHub repository");
  return canonical;
}

export interface SearchHit {
  id: string; source: string; sessionId: string; title: string; summary: string; repository?: string;
  branch?: string; pullRequest?: number; updatedAt: string; eventCount: number; score: number;
  snippets: Array<{ kind: string; timestamp: string; text: string; sourceFile: string }>;
  matchedBecause: string[];
}

export class CloudRuntime {
  readonly pool: Pool;
  readonly queue: Queue;
  readonly s3: S3Client;
  readonly parsers = new ParserRegistry();
  constructor(readonly config: CloudConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX ?? 10), statement_timeout: 15_000 });
    this.queue = new Queue("agenttraces-ingest", { connection: redisConnection(config.redisUrl), defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    this.s3 = new S3Client({ endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true, credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey } });
  }

  async migrate() { await this.pool.query(CLOUD_SCHEMA); }
  async health() { const result = await this.pool.query("SELECT 1 AS ok"); return result.rows[0]?.ok === 1; }
  async close() { await this.queue.close(); this.s3.destroy(); await this.pool.end(); }
  private publicUrl(path: string) { return this.config.publicWebUrl ? `${this.config.publicWebUrl.replace(/\/$/, "")}${path}` : path; }

  async registerDevice(input: { deviceId: string; publicKey: string; name?: string }) {
    if (!/^dev_[A-Za-z0-9_-]+$/.test(input.deviceId) || !input.publicKey.includes("BEGIN PUBLIC KEY")) throw new Error("Invalid device registration");
    const existing = await this.pool.query("SELECT id, principal_id, namespace_id, public_key FROM devices WHERE id=$1", [input.deviceId]);
    if (existing.rowCount) {
      if (existing.rows[0].public_key !== input.publicKey) throw new Error("Device ID already belongs to another key");
      return { deviceId: input.deviceId, principalId: existing.rows[0].principal_id, namespaceId: existing.rows[0].namespace_id, existing: true };
    }
    const principalId = opaque("pr_anon"); const namespaceId = opaque("ns_personal"); const accessToken = opaque("at");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO principals(id) VALUES($1)", [principalId]);
      await client.query("INSERT INTO namespaces(id,kind,owner_id,name) VALUES($1,'personal',$2,'Personal')", [namespaceId, principalId]);
      await client.query("INSERT INTO memberships VALUES($1,$2,'owner')", [principalId, namespaceId]);
      await client.query("INSERT INTO devices(id,principal_id,namespace_id,public_key,token_hash,name) VALUES($1,$2,$3,$4,$5,$6)", [input.deviceId, principalId, namespaceId, input.publicKey, hash(accessToken), input.name ?? "local-device"]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { deviceId: input.deviceId, principalId, namespaceId, accessToken, existing: false };
  }

  async device(deviceId: string) { const result = await this.pool.query("SELECT * FROM devices WHERE id=$1", [deviceId]); return result.rows[0]; }
  async actorForToken(token: string) {
    const result = await this.pool.query(`SELECT principal_id,namespace_id FROM devices WHERE token_hash=$1
      UNION ALL SELECT principal_id,namespace_id FROM web_identities WHERE token_hash=$1 LIMIT 1`, [hash(token)]);
    if (!result.rowCount) return null;
    return { principalId: String(result.rows[0].principal_id), namespaceId: String(result.rows[0].namespace_id) };
  }

  async exchangeWebIdentity(serviceSecret: string, input: { userId: string; email: string; name?: string }) {
    if (!this.config.webAuthSecret || serviceSecret !== this.config.webAuthSecret) throw new Error("Unauthorized");
    if (!input.userId || !validEmail(input.email)) throw new Error("Invalid web identity");
    const accessToken = opaque("at_web"); const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const known = await client.query("SELECT principal_id,namespace_id FROM web_identities WHERE external_user_id=$1 FOR UPDATE", [input.userId]);
      let principalId: string; let namespaceId: string;
      if (known.rowCount) { principalId = known.rows[0].principal_id; namespaceId = known.rows[0].namespace_id; }
      else {
        const existing = await client.query("SELECT id FROM principals WHERE lower(email)=lower($1) LIMIT 1", [input.email]);
        principalId = existing.rows[0]?.id ?? opaque("pr_user");
        if (!existing.rowCount) await client.query("INSERT INTO principals(id,kind,email,name) VALUES($1,'user',$2,$3)", [principalId, input.email.toLowerCase(), input.name ?? input.email]);
        const personal = await client.query("SELECT id FROM namespaces WHERE owner_id=$1 AND kind='personal' LIMIT 1", [principalId]);
        namespaceId = personal.rows[0]?.id ?? opaque("ns_personal");
        if (!personal.rowCount) {
          await client.query("INSERT INTO namespaces(id,kind,owner_id,name) VALUES($1,'personal',$2,'Personal')", [namespaceId, principalId]);
          await client.query("INSERT INTO memberships(principal_id,namespace_id,role) VALUES($1,$2,'owner')", [principalId, namespaceId]);
        }
        await client.query("INSERT INTO web_identities(external_user_id,principal_id,namespace_id,token_hash,email) VALUES($1,$2,$3,$4,$5)", [input.userId, principalId, namespaceId, hash(accessToken), input.email.toLowerCase()]);
      }
      if (known.rowCount) await client.query("UPDATE web_identities SET token_hash=$2,email=$3,updated_at=now() WHERE external_user_id=$1", [input.userId, hash(accessToken), input.email.toLowerCase()]);
      await client.query("COMMIT"); return { accessToken, principalId, namespaceId };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async claim(token: string, email: string, name?: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    if (!validEmail(email)) throw new Error("Invalid email");
    const normalizedEmail = email.toLowerCase(); const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT id FROM principals WHERE lower(email)=lower($1) AND id<>$2 FOR UPDATE", [normalizedEmail, actor.principalId]);
      const principalId = String(existing.rows[0]?.id ?? actor.principalId);
      if (principalId !== actor.principalId) {
        await client.query(`INSERT INTO memberships(principal_id,namespace_id,role)
          SELECT $1,namespace_id,role FROM memberships WHERE principal_id=$2
          ON CONFLICT(principal_id,namespace_id) DO UPDATE SET role=CASE
            WHEN memberships.role='owner' OR excluded.role='owner' THEN 'owner'
            WHEN memberships.role='admin' OR excluded.role='admin' THEN 'admin' ELSE 'member' END`, [principalId, actor.principalId]);
        await client.query("DELETE FROM memberships WHERE principal_id=$1", [actor.principalId]);
        for (const statement of [
          "UPDATE namespaces SET owner_id=$1 WHERE owner_id=$2",
          "UPDATE devices SET principal_id=$1,claimed=true WHERE principal_id=$2",
          "UPDATE web_identities SET principal_id=$1 WHERE principal_id=$2",
          "UPDATE traces SET owner_id=$1 WHERE owner_id=$2",
          "UPDATE setup_links SET created_by=$1 WHERE created_by=$2",
          "UPDATE team_repositories SET created_by=$1 WHERE created_by=$2",
          "UPDATE shares SET owner_id=$1 WHERE owner_id=$2",
        ]) await client.query(statement, [principalId, actor.principalId]);
        await client.query("DELETE FROM principals WHERE id=$1", [actor.principalId]);
      } else await client.query("UPDATE devices SET claimed=true WHERE principal_id=$1", [principalId]);
      await client.query("UPDATE principals SET kind='user',email=$1,name=$2 WHERE id=$3", [normalizedEmail, name ?? email, principalId]);
      await client.query("COMMIT");
      return { principalId, email: normalizedEmail, claimed: true, merged: principalId !== actor.principalId };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async createTeam(token: string, slug: string, defaultVisibility: "private" | "team" = "private") {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) throw new Error("Invalid team slug");
    const id = opaque("ns_team");
    if (!["private", "team"].includes(defaultVisibility)) throw new Error("Invalid team default visibility");
    await this.pool.query("WITH n AS (INSERT INTO namespaces(id,kind,owner_id,name,visibility_default) VALUES($1,'team',$2,$3,$4) RETURNING id) INSERT INTO memberships SELECT $2,id,'owner' FROM n", [id, actor.principalId, slug, defaultVisibility]);
    return { id, slug, role: "owner", defaultVisibility };
  }

  async setTeamPolicy(token: string, teamId: string, defaultVisibility: "private" | "team") {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`UPDATE namespaces n SET visibility_default=$3 WHERE n.id=$1 AND n.kind='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.namespace_id=n.id AND m.principal_id=$2 AND m.role IN ('owner','admin')) RETURNING id,name,visibility_default`, [teamId, actor.principalId, defaultVisibility]);
    if (!result.rowCount) throw new Error("Team not found or policy access denied"); return result.rows[0];
  }

  async listTeams(token: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`SELECT n.id,n.name,n.visibility_default,m.role,count(DISTINCT d.id)::int device_count
      FROM memberships m JOIN namespaces n ON n.id=m.namespace_id
      LEFT JOIN memberships members ON members.namespace_id=n.id LEFT JOIN devices d ON d.principal_id=members.principal_id
      WHERE m.principal_id=$1 AND n.kind='team' GROUP BY n.id,m.role ORDER BY n.name`, [actor.principalId]);
    return { teams: result.rows };
  }

  private async requireTeamAdmin(principalId: string, teamId: string) {
    const result = await this.pool.query("SELECT role FROM memberships WHERE principal_id=$1 AND namespace_id=$2 AND role IN ('owner','admin')", [principalId, teamId]);
    if (!result.rowCount) throw new Error("Team admin access denied");
  }

  async createSetupLink(token: string, teamId: string, options: { email?: string; domain?: string; maxUses?: number; expiresAt?: string } = {}) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    await this.requireTeamAdmin(actor.principalId, teamId);
    const maxUses = options.maxUses ?? 50;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) throw new Error("Invalid setup link max uses");
    if (options.expiresAt && Date.parse(options.expiresAt) <= Date.now()) throw new Error("Invalid setup link expiry");
    if (options.email && !validEmail(options.email)) throw new Error("Invalid setup link email");
    if (options.domain && !/^[a-z0-9.-]+$/i.test(options.domain)) throw new Error("Invalid setup link domain");
    const rawToken = randomBytes(24).toString("base64url"); const id = opaque("setup");
    const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
    await this.pool.query(`INSERT INTO setup_links(id,token_hash,namespace_id,created_by,email,domain,max_uses,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, hash(rawToken), teamId, actor.principalId, options.email?.toLowerCase() ?? null, options.domain?.toLowerCase() ?? null, maxUses, expiresAt]);
    return { id, token: rawToken, url: this.publicUrl(`/join/${rawToken}`), teamId, maxUses, expiresAt };
  }

  async listSetupLinks(token: string, teamId: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized"); await this.requireTeamAdmin(actor.principalId, teamId);
    const result = await this.pool.query(`SELECT id,email,domain,max_uses,uses_count,expires_at,revoked_at,created_at
      FROM setup_links WHERE namespace_id=$1 ORDER BY created_at DESC`, [teamId]);
    return { setupLinks: result.rows };
  }

  async revokeSetupLink(token: string, setupLinkId: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`UPDATE setup_links s SET revoked_at=now() WHERE s.id=$1 AND s.revoked_at IS NULL
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.namespace_id=s.namespace_id AND m.principal_id=$2 AND m.role IN ('owner','admin')) RETURNING s.id`, [setupLinkId, actor.principalId]);
    if (!result.rowCount) throw new Error("Setup link not found or access denied"); return { id: setupLinkId, revoked: true };
  }

  async redeemSetupLink(token: string, setupToken: string, suppliedEmail?: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`SELECT s.*,p.email principal_email FROM setup_links s CROSS JOIN principals p
        WHERE s.token_hash=$1 AND p.id=$2 FOR UPDATE OF s`, [hash(setupToken), actor.principalId]);
      const link = result.rows[0];
      if (!link || link.revoked_at) throw new Error("Setup link not found or revoked");
      if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) throw new Error("Setup link expired");
      if (link.max_uses !== null && Number(link.uses_count) >= Number(link.max_uses)) throw new Error("Setup link usage limit reached");
      const email = String(suppliedEmail ?? link.principal_email ?? "").toLowerCase();
      if (link.email && email !== link.email) throw new Error("Setup link is bound to another email");
      if (link.domain && email.split("@")[1] !== link.domain) throw new Error("Setup link requires an approved email domain");
      await client.query("INSERT INTO memberships(principal_id,namespace_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING", [actor.principalId, link.namespace_id]);
      await client.query("UPDATE setup_links SET uses_count=uses_count+1 WHERE id=$1", [link.id]);
      await client.query("COMMIT");
      return { teamId: link.namespace_id, principalId: actor.principalId, role: "member" };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async addTeamRepository(token: string, teamId: string, repository: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized"); await this.requireTeamAdmin(actor.principalId, teamId);
    const canonical = canonicalRepository(repository);
    await this.pool.query("INSERT INTO team_repositories(namespace_id,repository,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [teamId, canonical, actor.principalId]);
    return { teamId, repository: canonical };
  }

  async listTeamRepositories(token: string, teamId: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`SELECT tr.repository,tr.created_at FROM team_repositories tr WHERE tr.namespace_id=$1
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.namespace_id=tr.namespace_id AND m.principal_id=$2) ORDER BY tr.repository`, [teamId, actor.principalId]);
    if (!result.rowCount) {
      const membership = await this.pool.query("SELECT 1 FROM memberships WHERE namespace_id=$1 AND principal_id=$2", [teamId, actor.principalId]);
      if (!membership.rowCount) throw new Error("Team not found or inaccessible");
    }
    return { repositories: result.rows };
  }

  async listTeamDevices(token: string, teamId: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized"); await this.requireTeamAdmin(actor.principalId, teamId);
    const result = await this.pool.query(`SELECT d.id,d.name,d.claimed,d.created_at,d.last_seen_at,p.email,p.name principal_name,m.role
      FROM memberships m JOIN devices d ON d.principal_id=m.principal_id JOIN principals p ON p.id=m.principal_id
      WHERE m.namespace_id=$1 ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC`, [teamId]);
    return { devices: result.rows };
  }

  async connectGitHubInstallation(token: string, teamId: string, input: { installationId: string; accountLogin: string; permissions?: Record<string, string> }) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized"); await this.requireTeamAdmin(actor.principalId, teamId);
    if (!/^\d+$/.test(input.installationId) || !input.accountLogin) throw new Error("Invalid GitHub installation");
    const id = `ghi_${stableId(input.installationId)}`;
    await this.pool.query(`INSERT INTO github_installations(id,namespace_id,github_installation_id,account_login,permissions)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(github_installation_id) DO UPDATE SET namespace_id=excluded.namespace_id,account_login=excluded.account_login,
      permissions=excluded.permissions,updated_at=now()`, [id, teamId, input.installationId, input.accountLogin, JSON.stringify(input.permissions ?? {})]);
    return { id, teamId, installationId: input.installationId, accountLogin: input.accountLogin, connected: true };
  }

  async handleGitHubWebhook(eventName: string, payload: Record<string, unknown>) {
    const installation = payload.installation as Record<string, unknown> | undefined; const installationId = String(installation?.id ?? "");
    const linked = await this.pool.query("SELECT namespace_id FROM github_installations WHERE github_installation_id=$1", [installationId]);
    if (!linked.rowCount) return { accepted: true, linked: false, reason: "installation_not_connected" };
    if (eventName !== "pull_request") return { accepted: true, linked: true, event: eventName };
    const pullRequest = payload.pull_request as Record<string, unknown>; const repositoryPayload = payload.repository as Record<string, unknown>;
    if (!pullRequest || !repositoryPayload) throw new Error("Invalid GitHub pull request payload");
    const repository = canonicalRepository(String(repositoryPayload.html_url)); const repositoryRecord = await this.ensureRepository(repository);
    const number = Number(payload.number); const head = pullRequest.head as Record<string, unknown>; const base = pullRequest.base as Record<string, unknown>;
    const pullRequestId = `pr_${stableId(repositoryRecord.id, number)}`;
    await this.pool.query(`INSERT INTO pull_requests(id,repository_id,number,title,state,url,head_sha,base_sha,author_login)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(repository_id,number) DO UPDATE SET title=excluded.title,state=excluded.state,url=excluded.url,
      head_sha=excluded.head_sha,base_sha=excluded.base_sha,author_login=excluded.author_login,updated_at=now()`, [pullRequestId, repositoryRecord.id, number, pullRequest.title ?? null, pullRequest.state ?? null, pullRequest.html_url ?? null, head?.sha ?? null, base?.sha ?? null, (pullRequest.user as Record<string, unknown> | undefined)?.login ?? null]);
    await this.pool.query(`INSERT INTO trace_pull_requests(trace_id,pull_request_id,evidence,confidence,confirmed)
      SELECT DISTINCT t.id,$1,CASE WHEN tc.commit_sha=$2 THEN 'exact_commit' ELSE 'branch_repository' END,
        CASE WHEN tc.commit_sha=$2 THEN 1 ELSE .8 END,false FROM traces t
      LEFT JOIN trace_commits tc ON tc.trace_id=t.id AND tc.repository_id=$3
      WHERE t.namespace_id=$4 AND t.repository=$5 AND (tc.commit_sha=$2 OR t.branch=$6)
      ON CONFLICT(trace_id,pull_request_id) DO UPDATE SET evidence=excluded.evidence,confidence=GREATEST(trace_pull_requests.confidence,excluded.confidence)`, [pullRequestId, String(head?.sha ?? "").toLowerCase(), repositoryRecord.id, linked.rows[0].namespace_id, repository, String(head?.ref ?? "")]);
    return { accepted: true, linked: true, pullRequestId, repository, number };
  }

  async acceptBatch(deviceId: string, namespaceId: string, batchId: string, compressed: Buffer, eventCount: number) {
    if (compressed.byteLength > 20 * 1024 * 1024) throw new Error("Compressed batch exceeds 20MB");
    const known = await this.pool.query("SELECT id,status FROM ingest_batches WHERE id=$1", [batchId]);
    if (known.rowCount) return { batchId, accepted: 0, duplicates: eventCount, status: "durable", processing: known.rows[0].status };
    const authorized = await this.pool.query("SELECT 1 FROM devices d JOIN memberships m ON m.principal_id=d.principal_id AND m.namespace_id=$2 WHERE d.id=$1", [deviceId, namespaceId]);
    if (!authorized.rowCount) throw new Error("Device cannot ingest into that namespace");
    const objectKey = `native/${namespaceId}/${deviceId}/${new Date().toISOString().slice(0,10)}/${batchId}.json.gz`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.config.s3Bucket, Key: objectKey, Body: compressed, ContentType: "application/json", ContentEncoding: "gzip", Metadata: { deviceId, eventCount: String(eventCount) } }));
    await this.pool.query("INSERT INTO ingest_batches(id,device_id,namespace_id,object_key,event_count) VALUES($1,$2,$3,$4,$5)", [batchId, deviceId, namespaceId, objectKey, eventCount]);
    await this.queue.add("parse-batch", { batchId }, { jobId: batchId });
    return { batchId, accepted: eventCount, duplicates: 0, status: "durable", processing: "queued" };
  }

  async processBatch(batchId: string) {
    const result = await this.pool.query("SELECT b.*,d.principal_id FROM ingest_batches b JOIN devices d ON d.id=b.device_id WHERE b.id=$1", [batchId]);
    if (!result.rowCount) throw new Error("Unknown ingest batch");
    const batch = result.rows[0]; if (batch.status === "processed") return { batchId, processed: 0, duplicate: true };
    await this.pool.query("UPDATE ingest_batches SET status='processing',error=NULL WHERE id=$1", [batchId]);
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: batch.object_key }));
      const compressed = Buffer.from(await response.Body!.transformToByteArray());
      const { gunzipSync } = await import("node:zlib");
      const payload = JSON.parse(gunzipSync(compressed).toString("utf8")) as { batchId: string; envelopes: NativeEnvelope[] };
      let events = 0;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        for (const envelope of payload.envelopes) {
          assertNativeEnvelope(envelope);
          if (envelope.device_id !== batch.device_id) throw new Error("Envelope device mismatch");
          const parsed = this.parsers.parse(envelope); if (!parsed.success) throw new Error(parsed.error ?? "Parse failed");
          await this.persist(client, envelope, parsed.records, batch.principal_id, batch.namespace_id); events += parsed.records.length;
        }
        await client.query("UPDATE ingest_batches SET status='processed',processed_at=now() WHERE id=$1", [batchId]);
        await client.query("UPDATE devices SET last_seen_at=now() WHERE id=$1", [batch.device_id]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      return { batchId, envelopes: payload.envelopes.length, events };
    } catch (error) {
      await this.pool.query("UPDATE ingest_batches SET status='failed',error=$2 WHERE id=$1", [batchId, error instanceof Error ? error.message : String(error)]); throw error;
    }
  }

  private async persist(client: PoolClient, envelope: NativeEnvelope, records: NormalizedEvent[], ownerId: string, namespaceId: string) {
    const sessionId = envelope.session_id ?? stableId(envelope.source_file); const traceId = `tr_${stableId(namespaceId, envelope.source, sessionId)}`;
    const title = String(records.find((r) => r.kind === "user" && r.content)?.content ?? `${envelope.source} session`).slice(0, 160);
    await client.query(`INSERT INTO traces(id,namespace_id,owner_id,source,session_id,title,visibility,started_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,(SELECT visibility_default FROM namespaces WHERE id=$2),$7,$7)
      ON CONFLICT(id) DO UPDATE SET updated_at=GREATEST(traces.updated_at,excluded.updated_at)`, [traceId, namespaceId, ownerId, envelope.source, sessionId, title, envelope.timestamp]);
    for (const record of records) await client.query(`INSERT INTO events(id,trace_id,source_event_id,source,kind,role,content,tool_name,tool_call_id,
      operation_kind,operation_status,purpose,parent_event_id,child_trace_id,duration_ms,input,output,command,model,timestamp,input_tokens,output_tokens,cost_usd,cost_accuracy,parser_version,source_file,file_type,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT(trace_id,source_event_id) DO NOTHING`, [record.id, traceId, record.sourceEventId, record.source, record.kind, record.role ?? null, record.content ?? null, record.toolName ?? null, record.toolCallId ?? null,
      record.operationKind ?? null, record.operationStatus ?? null, record.purpose ?? null, record.parentEventId ?? null, record.childTraceId ?? null, record.durationMs ?? null, record.input ?? null, record.output ?? null,
      record.command ?? null, record.model ?? null, record.timestamp, record.inputTokens ?? null, record.outputTokens ?? null, record.costUsd ?? null, record.costAccuracy ?? null, record.parserVersion, record.sourceFile, record.fileType, record.metadata]);
    const repository = records.find((r) => r.repository)?.repository ?? envelope.git?.repository;
    const branch = records.find((r) => r.branch)?.branch ?? envelope.git?.branch;
    await client.query(`UPDATE traces t SET repository=COALESCE($2,t.repository),branch=COALESCE($3,t.branch),
      event_count=x.event_count,input_tokens=x.input_tokens,output_tokens=x.output_tokens,cost_usd=x.cost_usd,
      cost_accuracy=x.cost_accuracy,
      summary=COALESCE(x.summary,t.summary),started_at=x.started_at,updated_at=x.updated_at
      FROM (SELECT count(*)::int event_count,coalesce(sum(input_tokens),0)::bigint input_tokens,coalesce(sum(output_tokens),0)::bigint output_tokens,sum(cost_usd) cost_usd,
        CASE WHEN bool_or(cost_accuracy='exact') THEN 'exact' WHEN bool_or(cost_accuracy='estimated') THEN 'estimated' WHEN bool_or(cost_accuracy='subscription_included') THEN 'subscription_included' ELSE 'unavailable' END cost_accuracy,
        (array_agg(left(content,300) ORDER BY timestamp DESC) FILTER (WHERE content IS NOT NULL AND content<>''))[1] summary,min(timestamp) started_at,max(timestamp) updated_at FROM events WHERE trace_id=$1) x WHERE t.id=$1`, [traceId, repository ?? null, branch ?? null]);
  }

  async search(token: string, request: SearchRequest & { branch?: string; pullRequest?: number; cursor?: string }): Promise<{ results: SearchHit[]; nextCursor: string | null; bounds: object }> {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const limit = Math.min(Math.max(Number(request.limit ?? 5), 1), 10); const query = request.query.trim().slice(0, 500); if (!query) throw new Error("query is required");
    const params: unknown[] = [actor.principalId, query, limit + 1]; let index = 3;
    const teamAccess = `(t.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$1 AND m.namespace_id=t.namespace_id))`;
    const adminRepositoryAccess = `(t.repository IS NOT NULL AND EXISTS (SELECT 1 FROM team_repositories tr JOIN memberships m ON m.namespace_id=tr.namespace_id WHERE tr.namespace_id=t.namespace_id AND tr.repository=t.repository AND m.principal_id=$1 AND m.role IN ('owner','admin')))`;
    const access = request.scope === "mine" ? "t.owner_id=$1" : request.scope === "team" ? `(${teamAccess} OR ${adminRepositoryAccess})` : request.scope === "shared_with_me" ? "false" : `(t.owner_id=$1 OR t.visibility='public' OR ${teamAccess} OR ${adminRepositoryAccess})`;
    const filters = [access];
    if (request.repository) { params.push(request.repository); filters.push(`t.repository=$${++index}`); }
    if (request.source) { params.push(request.source); filters.push(`t.source=$${++index}`); }
    if (request.branch) { params.push(request.branch); filters.push(`t.branch=$${++index}`); }
    if (request.pullRequest) { params.push(request.pullRequest); filters.push(`(t.pull_request=$${++index} OR EXISTS (SELECT 1 FROM trace_pull_requests l JOIN pull_requests pr ON pr.id=l.pull_request_id WHERE l.trace_id=t.id AND pr.number=$${index}))`); }
    if (request.cursor) { params.push(new Date(Buffer.from(request.cursor, "base64url").toString("utf8"))); filters.push(`t.updated_at<$${++index}`); }
    const sql = `WITH q AS (SELECT websearch_to_tsquery('english',$2) query), event_candidates AS (
      SELECT e.trace_id,ts_rank_cd(e.search_document,q.query) lexical FROM events e JOIN traces t ON t.id=e.trace_id CROSS JOIN q
      WHERE ${access} AND e.search_document@@q.query ORDER BY lexical DESC,e.timestamp DESC LIMIT 2000
    ), ranked AS (
      SELECT t.*,coalesce(max(e.lexical),0) lexical,
        greatest(0,1-(extract(epoch from (now()-t.updated_at))/86400)/365) recency
      FROM traces t LEFT JOIN event_candidates e ON e.trace_id=t.id CROSS JOIN q
      WHERE ${filters.join(" AND ")} AND (e.trace_id IS NOT NULL OR t.title ILIKE '%'||$2||'%' OR t.summary ILIKE '%'||$2||'%' OR t.repository ILIKE '%'||$2||'%')
      GROUP BY t.id
    ) SELECT *,round((lexical*10+recency)::numeric,6)::float score FROM ranked ORDER BY score DESC,updated_at DESC LIMIT $3`;
    const result = await this.pool.query(sql, params); const rows = result.rows.slice(0, limit);
    const hits: SearchHit[] = [];
    for (const row of rows) {
      const snippets = await this.pool.query(`SELECT kind,timestamp,source_file,left(coalesce(content,command,tool_name,''),600) text FROM events,websearch_to_tsquery('english',$2) q WHERE trace_id=$1 AND search_document@@q ORDER BY ts_rank_cd(search_document,q) DESC,timestamp DESC LIMIT 3`, [row.id, query]);
      hits.push({ id: row.id, source: row.source, sessionId: row.session_id, title: row.title, summary: row.summary, repository: row.repository ?? undefined, branch: row.branch ?? undefined, pullRequest: row.pull_request ?? undefined, updatedAt: row.updated_at.toISOString(), eventCount: row.event_count, score: row.score, snippets: snippets.rows.map((s) => ({ kind: s.kind, timestamp: s.timestamp.toISOString(), text: s.text, sourceFile: s.source_file })), matchedBecause: ["authorized trace", "lexical evidence", row.repository === request.repository ? "repository filter" : "recency"].filter(Boolean) });
    }
    const last = rows.at(-1); return { results: hits, nextCursor: result.rows.length > limit && last ? Buffer.from(last.updated_at.toISOString()).toString("base64url") : null, bounds: { maxTraces: 10, maxSnippetsPerTrace: 3, maxSnippetCharacters: 600 } };
  }

  async getTrace(token: string, traceId: string, view = "summary") {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`SELECT t.* FROM traces t WHERE t.id=$1 AND (t.owner_id=$2 OR t.visibility='public'
      OR (t.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$2 AND m.namespace_id=t.namespace_id))
      OR (t.repository IS NOT NULL AND EXISTS (SELECT 1 FROM team_repositories tr JOIN memberships m ON m.namespace_id=tr.namespace_id
        WHERE tr.namespace_id=t.namespace_id AND tr.repository=t.repository AND m.principal_id=$2 AND m.role IN ('owner','admin'))))`, [traceId, actor.principalId]);
    if (!result.rowCount) throw new Error("Trace not found or inaccessible"); const trace = result.rows[0];
    if (!["full_transcript","commands","files"].includes(view)) return trace;
    const kinds = view === "commands" ? ["command","tool_call"] : view === "files" ? ["file"] : null;
    const events = await this.pool.query(`SELECT id,kind,role,content,tool_name,tool_call_id,operation_kind,operation_status,purpose,
      parent_event_id,child_trace_id,duration_ms,input,output,command,model,timestamp,source_file,file_type,metadata
      FROM events WHERE trace_id=$1 ${kinds ? "AND kind=ANY($2)" : ""} ORDER BY timestamp,id LIMIT 500`, kinds ? [traceId, kinds] : [traceId]);
    return { ...trace, events: events.rows, truncated: trace.event_count > events.rowCount! };
  }

  async listTraces(token: string, options: { teamId?: string; repository?: string; source?: string; limit?: number } = {}) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const params: unknown[] = [actor.principalId]; const filters = [`(t.owner_id=$1 OR t.visibility='public'
      OR (t.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$1 AND m.namespace_id=t.namespace_id))
      OR (t.repository IS NOT NULL AND EXISTS (SELECT 1 FROM team_repositories tr JOIN memberships m ON m.namespace_id=tr.namespace_id
        WHERE tr.namespace_id=t.namespace_id AND tr.repository=t.repository AND m.principal_id=$1 AND m.role IN ('owner','admin'))))`];
    if (options.teamId) { params.push(options.teamId); filters.push(`t.namespace_id=$${params.length}`); }
    if (options.repository) { params.push(canonicalRepository(options.repository)); filters.push(`t.repository=$${params.length}`); }
    if (options.source) { params.push(options.source); filters.push(`t.source=$${params.length}`); }
    params.push(Math.min(Math.max(Number(options.limit ?? 50), 1), 200));
    const result = await this.pool.query(`SELECT t.*,p.email owner_email,p.name owner_name,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'repository',r.canonical_name,'number',pr.number,'title',pr.title,'state',pr.state,'url',pr.url,'evidence',l.evidence,'confidence',l.confidence,'confirmed',l.confirmed) ORDER BY pr.number)
        FROM trace_pull_requests l JOIN pull_requests pr ON pr.id=l.pull_request_id JOIN repositories r ON r.id=pr.repository_id WHERE l.trace_id=t.id),'[]') pull_requests
      FROM traces t JOIN principals p ON p.id=t.owner_id WHERE ${filters.join(" AND ")} ORDER BY t.updated_at DESC LIMIT $${params.length}`, params);
    return { traces: result.rows };
  }

  async usage(token: string, options: { teamId?: string; repository?: string } = {}) {
    const { traces } = await this.listTraces(token, { ...options, limit: 200 });
    const inputTokens = traces.reduce((sum, trace) => sum + Number(trace.input_tokens), 0);
    const outputTokens = traces.reduce((sum, trace) => sum + Number(trace.output_tokens), 0);
    const accuracies = new Set(traces.map((trace) => trace.cost_accuracy));
    return { sessions: traces.length, inputTokens, outputTokens, costUsd: traces.reduce((sum, trace) => sum + Number(trace.cost_usd ?? 0), 0), accuracy: accuracies.size === 1 ? [...accuracies][0] : "mixed" };
  }

  async prepareTraceEnrichment(token: string, traceId: string) {
    const trace = await this.getTrace(token, traceId, "full_transcript") as Record<string, unknown> & { events: Record<string, unknown>[] };
    return { traceId, currentTitle: trace.title, currentSummary: trace.summary, repository: trace.repository, source: trace.source,
      promptVersion: "trace-summary-v1", events: trace.events.filter((event) => ["user","assistant","tool_call","tool_result","error"].includes(String(event.kind))).slice(0, 80)
        .map((event) => ({ id: event.id, kind: event.kind, role: event.role, operationKind: event.operation_kind, text: String(event.content ?? event.command ?? event.tool_name ?? "").slice(0, 2_000) })) };
  }

  async cacheTraceEnrichment(token: string, input: Omit<TraceEnrichment, "generatedAt" | "provider"> & { provider?: TraceEnrichment["provider"] }) {
    await this.getTrace(token, input.traceId, "metadata");
    if (!input.title.trim() || !input.summary.trim() || !Array.isArray(input.stages)) throw new Error("Invalid trace enrichment");
    const provider = input.provider === "team_byok" ? "team_byok" : "local_subscription";
    await this.pool.query(`INSERT INTO trace_enrichments(trace_id,title,summary,stages,outcome,provider,model,prompt_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(trace_id) DO UPDATE SET title=excluded.title,summary=excluded.summary,stages=excluded.stages,
      outcome=excluded.outcome,provider=excluded.provider,model=excluded.model,prompt_version=excluded.prompt_version,generated_at=now()`,
      [input.traceId, input.title.slice(0, 160), input.summary.slice(0, 2_000), JSON.stringify(input.stages.slice(0, 8)), input.outcome, provider, input.model ?? null, input.promptVersion]);
    await this.pool.query("UPDATE traces SET title=$2,summary=$3,enrichment_status='ready' WHERE id=$1", [input.traceId, input.title.slice(0, 160), input.summary.slice(0, 2_000)]);
    return { ...input, provider, generatedAt: new Date().toISOString() };
  }

  private async ensureRepository(repository: string) {
    const canonical = canonicalRepository(repository); const id = `repo_${stableId(canonical.toLowerCase())}`;
    await this.pool.query("INSERT INTO repositories(id,canonical_name) VALUES($1,$2) ON CONFLICT(canonical_name) DO NOTHING", [id, canonical]);
    return { id, canonical };
  }

  async linkTraceToPullRequest(token: string, traceId: string, input: { repository: string; number: number; title?: string; state?: string; url?: string; headSha?: string; baseSha?: string; authorLogin?: string; evidence?: LinkEvidence; confidence?: number; confirmed?: boolean }) {
    await this.getTrace(token, traceId, "metadata");
    if (!Number.isInteger(input.number) || input.number < 1) throw new Error("Invalid pull request number");
    const confidence = input.confidence ?? (input.evidence === "time_file_overlap" ? 0.65 : 1);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Invalid link confidence");
    const repository = await this.ensureRepository(input.repository); const pullRequestId = `pr_${stableId(repository.id, input.number)}`;
    await this.pool.query(`INSERT INTO pull_requests(id,repository_id,number,title,state,url,head_sha,base_sha,author_login)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(repository_id,number) DO UPDATE SET title=excluded.title,state=excluded.state,url=excluded.url,
      head_sha=excluded.head_sha,base_sha=excluded.base_sha,author_login=excluded.author_login,updated_at=now()`, [pullRequestId, repository.id, input.number, input.title ?? null, input.state ?? null, input.url ?? null, input.headSha ?? null, input.baseSha ?? null, input.authorLogin ?? null]);
    await this.pool.query(`INSERT INTO trace_pull_requests(trace_id,pull_request_id,evidence,confidence,confirmed) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(trace_id,pull_request_id) DO UPDATE SET evidence=excluded.evidence,confidence=excluded.confidence,confirmed=excluded.confirmed`,
      [traceId, pullRequestId, input.evidence ?? "manual", confidence, input.confirmed ?? false]);
    return { traceId, pullRequestId, repository: repository.canonical, number: input.number, evidence: input.evidence ?? "manual", confidence, confirmed: input.confirmed ?? false };
  }

  async getPullRequestTrace(token: string, repository: string, number: number) {
    const canonical = canonicalRepository(repository);
    const pullRequest = await this.pool.query(`SELECT pr.*,r.canonical_name repository FROM pull_requests pr JOIN repositories r ON r.id=pr.repository_id
      WHERE r.canonical_name=$1 AND pr.number=$2`, [canonical, number]);
    if (!pullRequest.rowCount) return { pullRequest: null, traces: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, accuracy: "unavailable" } };
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const traces = await this.pool.query(`SELECT t.*,l.evidence,l.confidence,l.confirmed FROM trace_pull_requests l JOIN traces t ON t.id=l.trace_id
      WHERE l.pull_request_id=$1 AND (t.owner_id=$2 OR t.visibility='public' OR (t.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$2 AND m.namespace_id=t.namespace_id))
      OR (t.repository IS NOT NULL AND EXISTS (SELECT 1 FROM team_repositories tr JOIN memberships m ON m.namespace_id=tr.namespace_id WHERE tr.namespace_id=t.namespace_id AND tr.repository=t.repository AND m.principal_id=$2 AND m.role IN ('owner','admin')))) ORDER BY t.updated_at DESC`, [pullRequest.rows[0].id, actor.principalId]);
    return { pullRequest: pullRequest.rows[0], traces: traces.rows, usage: { inputTokens: traces.rows.reduce((sum, row) => sum + Number(row.input_tokens), 0), outputTokens: traces.rows.reduce((sum, row) => sum + Number(row.output_tokens), 0), costUsd: traces.rows.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0), accuracy: traces.rows.some((row) => row.cost_accuracy === "exact") ? "mixed_or_exact" : traces.rows.some((row) => row.cost_accuracy === "estimated") ? "estimated" : traces.rows.some((row) => row.cost_accuracy === "subscription_included") ? "subscription_included" : "unavailable" } };
  }

  private async sharePayload(traceId: string, view: string, selectedEventIds: string[] = []) {
    const traceResult = await this.pool.query("SELECT * FROM traces WHERE id=$1", [traceId]); if (!traceResult.rowCount) throw new Error("Trace not found");
    const enrichment = await this.pool.query("SELECT * FROM trace_enrichments WHERE trace_id=$1", [traceId]);
    const events = await this.pool.query(`SELECT id,kind,role,content,tool_name,tool_call_id,operation_kind,operation_status,purpose,parent_event_id,child_trace_id,duration_ms,input,output,command,model,timestamp
      FROM events WHERE trace_id=$1 ORDER BY timestamp,id LIMIT 500`, [traceId]);
    const selected = new Set(selectedEventIds); const rows = view === "overview" ? events.rows.filter((event) => ["user","assistant","error"].includes(event.kind)).slice(0, 12)
      : view === "conversation" ? events.rows.filter((event) => ["user","assistant"].includes(event.kind))
      : view === "highlights" ? events.rows.filter((event) => selected.size ? selected.has(event.id) : ["user","assistant","error"].includes(event.kind)).slice(0, 100) : events.rows;
    return { snapshotVersion: 1, view, trace: traceResult.rows[0], enrichment: enrichment.rows[0] ?? null, events: rows, truncated: rows.length < events.rows.length };
  }

  async createShare(token: string, spec: ShareSpec) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const trace = await this.pool.query("SELECT t.*,COALESCE(e.title,t.title) share_title FROM traces t LEFT JOIN trace_enrichments e ON e.trace_id=t.id WHERE t.id=$1 AND t.owner_id=$2", [spec.traceId, actor.principalId]); if (!trace.rowCount) throw new Error("Only the trace owner can share it");
    const id = opaque("share"); const rawToken = randomBytes(18).toString("base64url"); const live = spec.live === true;
    const view = spec.content === "full_transcript" ? "full_trace" : spec.content === "selected_messages" ? "highlights" : ["metadata","summary","skill"].includes(spec.content) ? "overview" : spec.content;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO shares(id,token_hash,trace_id,owner_id,spec) VALUES($1,$2,$3,$4,$5)", [id, hash(rawToken), spec.traceId, actor.principalId, JSON.stringify({ ...spec, live })]);
      if (!live) await client.query("INSERT INTO share_snapshots(share_id,view,payload,source_updated_at) VALUES($1,$2,$3,$4)", [id, view, JSON.stringify(await this.sharePayload(spec.traceId, view, spec.selectedEventIds)), trace.rows[0].updated_at]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return { id, token: rawToken, url: this.publicUrl(sharePath(String(trace.rows[0].share_title), rawToken)), snapshot: !live, ...spec, live };
  }

  async getShare(pathSegment: string, viewerKey?: string) {
    const rawToken = shareToken(pathSegment);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM shares WHERE token_hash=$1 FOR UPDATE", [hash(rawToken)]); const share = result.rows[0];
      if (!share || share.revoked_at) throw new Error("Share not found or revoked"); const spec = share.spec as ShareSpec;
      if (spec.expiresAt && Date.parse(spec.expiresAt) <= Date.now()) throw new Error("Share expired");
      if (spec.maxViews && Number(share.view_count) >= spec.maxViews) throw new Error("Share view limit reached");
      await client.query("UPDATE shares SET view_count=view_count+1 WHERE id=$1", [share.id]);
      await client.query("INSERT INTO share_access(id,share_id,viewer_hash) VALUES($1,$2,$3)", [opaque("access"), share.id, viewerKey ? hash(viewerKey) : null]);
      const snapshot = await client.query("SELECT payload FROM share_snapshots WHERE share_id=$1", [share.id]);
      const view = spec.content === "full_transcript" ? "full_trace" : spec.content === "selected_messages" ? "highlights" : ["metadata","summary","skill"].includes(spec.content) ? "overview" : spec.content;
      const payload = snapshot.rows[0]?.payload ?? await this.sharePayload(share.trace_id, view, spec.selectedEventIds);
      await client.query("COMMIT"); return { ...payload, snapshot: !spec.live };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async revokeShare(token: string, shareId: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query("UPDATE shares SET revoked_at=now() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id", [shareId, actor.principalId]);
    if (!result.rowCount) throw new Error("Share not found or already revoked"); return { id: shareId, revoked: true };
  }

  async prepareMutation(token: string, action: "share.create" | "skill.create", payload: unknown, ttlSeconds = 300) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const confirmationToken = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.pool.query("INSERT INTO mutation_confirmations(token_hash,principal_id,action,payload,expires_at) VALUES($1,$2,$3,$4,$5)", [hash(confirmationToken), actor.principalId, action, JSON.stringify(payload), expiresAt]);
    return { status: "confirmation_required", confirmationToken, action, preview: payload, expiresAt, consequences: action === "share.create" ? "Creates a revocable permission capability for the exact audience and content shown." : "Creates a reusable skill containing the exact instructions and trace provenance shown." };
  }

  async consumeMutation<T>(token: string, confirmationToken: string, action: "share.create" | "skill.create") {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM mutation_confirmations WHERE token_hash=$1 AND principal_id=$2 AND action=$3 FOR UPDATE", [hash(confirmationToken), actor.principalId, action]);
      const confirmation = result.rows[0];
      if (!confirmation || confirmation.consumed_at || new Date(confirmation.expires_at).getTime() <= Date.now()) throw new Error("Confirmation token is invalid, expired, or already used");
      await client.query("UPDATE mutation_confirmations SET consumed_at=now() WHERE token_hash=$1", [hash(confirmationToken)]);
      await client.query("COMMIT");
      return confirmation.payload as T;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async createSkill(token: string, input: { name: string; description?: string; instructions: string[]; validation?: string[]; traceIds: string[]; visibility?: string }) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    if (!input.name?.trim() || !Array.isArray(input.instructions) || !Array.isArray(input.traceIds) || !input.traceIds.length) throw new Error("Invalid skill");
    for (const traceId of input.traceIds) await this.getTrace(token, traceId, "summary");
    const id = opaque("skill"); const visibility = input.visibility ?? "private";
    if (!["private","team","direct_link","public"].includes(visibility)) throw new Error("Invalid visibility");
    await this.pool.query(`INSERT INTO reusable_skills(id,namespace_id,owner_id,name,description,instructions,validation,trace_ids,visibility)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, actor.namespaceId, actor.principalId, input.name.trim(), input.description ?? "", JSON.stringify(input.instructions), JSON.stringify(input.validation ?? []), JSON.stringify(input.traceIds), visibility]);
    return this.getSkill(token, id);
  }

  async listSkills(token: string, query = "") {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`SELECT s.* FROM reusable_skills s WHERE s.archived_at IS NULL AND (s.name ILIKE $2 OR s.description ILIKE $2)
      AND (s.owner_id=$1 OR s.visibility='public' OR (s.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$1 AND m.namespace_id=s.namespace_id)))
      ORDER BY s.created_at DESC LIMIT 100`, [actor.principalId, `%${query.slice(0,200)}%`]);
    return { skills: result.rows };
  }

  async getSkill(token: string, skillId: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const result = await this.pool.query(`SELECT s.* FROM reusable_skills s WHERE s.id=$2 AND s.archived_at IS NULL
      AND (s.owner_id=$1 OR s.visibility='public' OR (s.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$1 AND m.namespace_id=s.namespace_id)))`, [actor.principalId, skillId]);
    if (!result.rowCount) throw new Error("Skill not found or inaccessible"); return result.rows[0];
  }

  createWorker() { return new Worker("agenttraces-ingest", async (job: Job<{ batchId: string }>) => this.processBatch(job.data.batchId), { connection: redisConnection(this.config.redisUrl), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) }); }
}

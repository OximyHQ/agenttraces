import { createHash, randomBytes } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool, type PoolClient } from "pg";
import {
  ParserRegistry, assertNativeEnvelope, stableId, type NativeEnvelope, type NormalizedEvent,
  type SearchRequest,
} from "@agenttraces/core";
import type { CloudConfig } from "./config.js";
import { CLOUD_SCHEMA } from "./schema.js";

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function opaque(prefix: string) { return `${prefix}_${randomBytes(18).toString("base64url")}`; }
function redisConnection(url: string) { const parsed = new URL(url); return { host: parsed.hostname, port: Number(parsed.port || 6379), username: parsed.username || undefined, password: parsed.password || undefined, tls: parsed.protocol === "rediss:" ? {} : undefined }; }

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
    const result = await this.pool.query("SELECT principal_id,namespace_id FROM devices WHERE token_hash=$1", [hash(token)]);
    if (!result.rowCount) return null;
    return { principalId: String(result.rows[0].principal_id), namespaceId: String(result.rows[0].namespace_id) };
  }

  async claim(token: string, email: string, name?: string) {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email");
    await this.pool.query("UPDATE principals SET kind='user',email=$1,name=$2 WHERE id=$3", [email.toLowerCase(), name ?? email, actor.principalId]);
    await this.pool.query("UPDATE devices SET claimed=true WHERE principal_id=$1", [actor.principalId]);
    return { principalId: actor.principalId, email: email.toLowerCase(), claimed: true };
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
    for (const record of records) await client.query(`INSERT INTO events(id,trace_id,source_event_id,source,kind,role,content,tool_name,tool_call_id,command,model,timestamp,input_tokens,output_tokens,cost_usd,cost_accuracy,parser_version,source_file,file_type,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT(trace_id,source_event_id) DO NOTHING`, [record.id, traceId, record.sourceEventId, record.source, record.kind, record.role ?? null, record.content ?? null, record.toolName ?? null, record.toolCallId ?? null, record.command ?? null, record.model ?? null, record.timestamp, record.inputTokens ?? null, record.outputTokens ?? null, record.costUsd ?? null, record.costAccuracy ?? null, record.parserVersion, record.sourceFile, record.fileType, record.metadata]);
    const repository = records.find((r) => r.repository)?.repository ?? envelope.git?.repository;
    const branch = records.find((r) => r.branch)?.branch ?? envelope.git?.branch;
    await client.query(`UPDATE traces t SET repository=COALESCE($2,t.repository),branch=COALESCE($3,t.branch),
      event_count=x.event_count,input_tokens=x.input_tokens,output_tokens=x.output_tokens,cost_usd=x.cost_usd,
      cost_accuracy=CASE WHEN x.cost_usd IS NULL THEN 'unavailable' ELSE 'estimated' END,
      summary=COALESCE(x.summary,t.summary),started_at=x.started_at,updated_at=x.updated_at
      FROM (SELECT count(*)::int event_count,coalesce(sum(input_tokens),0)::bigint input_tokens,coalesce(sum(output_tokens),0)::bigint output_tokens,sum(cost_usd) cost_usd,
        (array_agg(left(content,300) ORDER BY timestamp DESC) FILTER (WHERE content IS NOT NULL AND content<>''))[1] summary,min(timestamp) started_at,max(timestamp) updated_at FROM events WHERE trace_id=$1) x WHERE t.id=$1`, [traceId, repository ?? null, branch ?? null]);
  }

  async search(token: string, request: SearchRequest & { branch?: string; pullRequest?: number; cursor?: string }): Promise<{ results: SearchHit[]; nextCursor: string | null; bounds: object }> {
    const actor = await this.actorForToken(token); if (!actor) throw new Error("Unauthorized");
    const limit = Math.min(Math.max(Number(request.limit ?? 5), 1), 10); const query = request.query.trim().slice(0, 500); if (!query) throw new Error("query is required");
    const params: unknown[] = [actor.principalId, query, limit + 1]; let index = 3;
    const filters = ["(t.owner_id=$1 OR t.visibility='public' OR (t.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$1 AND m.namespace_id=t.namespace_id)))"];
    if (request.repository) { params.push(request.repository); filters.push(`t.repository=$${++index}`); }
    if (request.source) { params.push(request.source); filters.push(`t.source=$${++index}`); }
    if (request.branch) { params.push(request.branch); filters.push(`t.branch=$${++index}`); }
    if (request.pullRequest) { params.push(request.pullRequest); filters.push(`t.pull_request=$${++index}`); }
    if (request.cursor) { params.push(new Date(Buffer.from(request.cursor, "base64url").toString("utf8"))); filters.push(`t.updated_at<$${++index}`); }
    const sql = `WITH q AS (SELECT websearch_to_tsquery('english',$2) query), ranked AS (
      SELECT t.*,max(ts_rank_cd(e.search_document,q.query)) lexical,
        greatest(0,1-(extract(epoch from (now()-t.updated_at))/86400)/365) recency
      FROM traces t JOIN events e ON e.trace_id=t.id CROSS JOIN q
      WHERE ${filters.join(" AND ")} AND (e.search_document@@q.query OR t.title ILIKE '%'||$2||'%' OR t.summary ILIKE '%'||$2||'%' OR t.repository ILIKE '%'||$2||'%')
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
    const result = await this.pool.query(`SELECT t.* FROM traces t WHERE t.id=$1 AND (t.owner_id=$2 OR t.visibility='public' OR (t.visibility='team' AND EXISTS (SELECT 1 FROM memberships m WHERE m.principal_id=$2 AND m.namespace_id=t.namespace_id)))`, [traceId, actor.principalId]);
    if (!result.rowCount) throw new Error("Trace not found or inaccessible"); const trace = result.rows[0];
    if (!["full_transcript","commands","files"].includes(view)) return trace;
    const kinds = view === "commands" ? ["command","tool_call"] : view === "files" ? ["file"] : null;
    const events = await this.pool.query(`SELECT id,kind,role,content,tool_name,command,model,timestamp,source_file,file_type,metadata FROM events WHERE trace_id=$1 ${kinds ? "AND kind=ANY($2)" : ""} ORDER BY timestamp,id LIMIT 500`, kinds ? [traceId, kinds] : [traceId]);
    return { ...trace, events: events.rows, truncated: trace.event_count > events.rowCount! };
  }

  createWorker() { return new Worker("agenttraces-ingest", async (job: Job<{ batchId: string }>) => this.processBatch(job.data.batchId), { connection: redisConnection(this.config.redisUrl), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) }); }
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { MCP_TOOLS, verifyDeviceSignature, type JsonRpcRequest, type NativeEnvelope } from "@agenttraces/core";
import type { CloudRuntime } from "./runtime.js";

function send(response: ServerResponse, status: number, value: unknown) { const body = JSON.stringify(value, (key, item) => key === "stack" || item instanceof Error ? undefined : item); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" }); response.end(body); }
async function readBody(request: IncomingMessage, max = 20 * 1024 * 1024) { const chunks: Buffer[] = []; let size = 0; for await (const part of request) { const chunk = Buffer.from(part as Uint8Array); size += chunk.length; if (size > max) throw new Error("Request too large"); chunks.push(chunk); } return Buffer.concat(chunks); }
function bearer(request: IncomingMessage) { const value = request.headers.authorization; return value?.startsWith("Bearer ") ? value.slice(7) : ""; }
function validGitHubSignature(secret: string | undefined, body: Buffer, signature: string) {
  if (!secret || !signature.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`); const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function createCloudApi(runtime: CloudRuntime) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { status: await runtime.health() ? "ok" : "degraded", service: "agenttraces-api", version: "0.2.0" });
      if (request.method === "POST" && url.pathname === "/v1/devices/register") return send(response, 201, await runtime.registerDevice(JSON.parse((await readBody(request, 128 * 1024)).toString("utf8"))));
      if (request.method === "POST" && url.pathname === "/v1/auth/exchange") return send(response, 200, await runtime.exchangeWebIdentity(String(request.headers["x-agenttraces-web-secret"] ?? ""), JSON.parse((await readBody(request, 32 * 1024)).toString("utf8"))));
      if (request.method === "POST" && url.pathname === "/v1/claim") { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 200, await runtime.claim(bearer(request), value.email, value.name)); }
      if (request.method === "POST" && url.pathname === "/v1/teams") { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 201, await runtime.createTeam(bearer(request), value.slug, value.defaultVisibility)); }
      if (request.method === "GET" && url.pathname === "/v1/teams") return send(response, 200, await runtime.listTeams(bearer(request)));
      if (request.method === "PATCH" && /^\/v1\/teams\/[^/]+\/policy$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 200, await runtime.setTeamPolicy(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!), value.defaultVisibility)); }
      if (request.method === "POST" && /^\/v1\/teams\/[^/]+\/setup-links$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 201, await runtime.createSetupLink(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!), value)); }
      if (request.method === "GET" && /^\/v1\/teams\/[^/]+\/setup-links$/.test(url.pathname)) return send(response, 200, await runtime.listSetupLinks(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!)));
      if (request.method === "POST" && /^\/v1\/setup-links\/[^/]+\/revoke$/.test(url.pathname)) return send(response, 200, await runtime.revokeSetupLink(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!)));
      if (request.method === "POST" && url.pathname === "/v1/setup-links/redeem") { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 200, await runtime.redeemSetupLink(bearer(request), value.token, value.email)); }
      if (request.method === "POST" && /^\/v1\/teams\/[^/]+\/repositories$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 201, await runtime.addTeamRepository(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!), value.repository)); }
      if (request.method === "GET" && /^\/v1\/teams\/[^/]+\/repositories$/.test(url.pathname)) return send(response, 200, await runtime.listTeamRepositories(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!)));
      if (request.method === "GET" && /^\/v1\/teams\/[^/]+\/devices$/.test(url.pathname)) return send(response, 200, await runtime.listTeamDevices(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!)));
      if (request.method === "POST" && /^\/v1\/teams\/[^/]+\/github\/installations$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 201, await runtime.connectGitHubInstallation(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!), value)); }
      if (request.method === "POST" && url.pathname === "/v1/github/webhooks") {
        const wire = await readBody(request, 2 * 1024 * 1024); const signature = String(request.headers["x-hub-signature-256"] ?? "");
        if (!validGitHubSignature(runtime.config.githubWebhookSecret, wire, signature)) return send(response, 401, { error: "Invalid GitHub webhook signature" });
        return send(response, 202, await runtime.handleGitHubWebhook(String(request.headers["x-github-event"] ?? "unknown"), JSON.parse(wire.toString("utf8"))));
      }
      if (request.method === "POST" && url.pathname === "/v1/ingest") {
        const wire = await readBody(request); const raw = request.headers["content-encoding"] === "gzip" ? gunzipSync(wire) : wire;
        const signature = String(request.headers["x-agenttraces-signature"] ?? ""); const deviceId = String(request.headers["x-agenttraces-device-id"] ?? ""); const device = await runtime.device(deviceId);
        if (!device || !verifyDeviceSignature(device.public_key, raw.toString("base64"), signature)) return send(response, 401, { error: "Invalid device signature" });
        const payload = JSON.parse(raw.toString("utf8")) as { batchId: string; envelopes: NativeEnvelope[] };
        const namespaceId = String(request.headers["x-agenttraces-namespace-id"] ?? device.namespace_id);
        return send(response, 202, await runtime.acceptBatch(deviceId, namespaceId, payload.batchId, request.headers["content-encoding"] === "gzip" ? wire : gzipSync(raw), payload.envelopes.length));
      }
      if (request.method === "POST" && url.pathname === "/v1/search") return send(response, 200, await runtime.search(bearer(request), JSON.parse((await readBody(request, 128 * 1024)).toString("utf8"))));
      if (request.method === "GET" && url.pathname === "/v1/traces") return send(response, 200, await runtime.listTraces(bearer(request), { teamId: url.searchParams.get("teamId") ?? undefined, repository: url.searchParams.get("repository") ?? undefined, source: url.searchParams.get("source") ?? undefined, limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined }));
      if (request.method === "GET" && url.pathname === "/v1/usage") return send(response, 200, await runtime.usage(bearer(request), { teamId: url.searchParams.get("teamId") ?? undefined, repository: url.searchParams.get("repository") ?? undefined }));
      if (request.method === "POST" && /^\/v1\/traces\/[^/]+\/enrichment\/prepare$/.test(url.pathname)) return send(response, 200, await runtime.prepareTraceEnrichment(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!)));
      if (request.method === "PUT" && /^\/v1\/traces\/[^/]+\/enrichment$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8")); return send(response, 200, await runtime.cacheTraceEnrichment(bearer(request), { ...value, traceId: decodeURIComponent(url.pathname.split("/")[3]!) })); }
      if (request.method === "POST" && /^\/v1\/traces\/[^/]+\/pull-requests$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 64 * 1024)).toString("utf8")); return send(response, 201, await runtime.linkTraceToPullRequest(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!), value)); }
      if (request.method === "GET" && url.pathname === "/v1/pull-requests/trace") return send(response, 200, await runtime.getPullRequestTrace(bearer(request), String(url.searchParams.get("repository") ?? ""), Number(url.searchParams.get("number"))));
      if (request.method === "POST" && /^\/v1\/traces\/[^/]+\/shares$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 64 * 1024)).toString("utf8")); return send(response, 201, await runtime.createShare(bearer(request), { ...value, traceId: decodeURIComponent(url.pathname.split("/")[3]!) })); }
      if (request.method === "POST" && /^\/v1\/shares\/[^/]+\/revoke$/.test(url.pathname)) return send(response, 200, await runtime.revokeShare(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!)));
      if (request.method === "GET" && url.pathname.startsWith("/v1/public/shares/")) return send(response, 200, await runtime.getShare(decodeURIComponent(url.pathname.slice(18)), `${request.socket.remoteAddress ?? ""}:${request.headers["user-agent"] ?? ""}`));
      if (request.method === "GET" && url.pathname.startsWith("/v1/traces/")) return send(response, 200, await runtime.getTrace(bearer(request), decodeURIComponent(url.pathname.slice(11)), url.searchParams.get("view") ?? "summary"));
      if (request.method === "POST" && url.pathname === "/mcp") {
        const rpc = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8")) as JsonRpcRequest; let result: unknown;
        if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agenttraces-cloud", version: "0.2.0" } };
        else if (rpc.method === "tools/list") result = { tools: MCP_TOOLS };
        else if (rpc.method === "tools/call") {
          const name = String(rpc.params?.name); const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>; let value: unknown;
          if (name === "search_traces") value = await runtime.search(bearer(request), args as never);
          else if (name === "get_trace") value = await runtime.getTrace(bearer(request), String(args.trace_id), String(args.view ?? "summary"));
          else if (name === "get_current_trace") value = (await runtime.listTraces(bearer(request), { limit: 1 })).traces[0] ?? null;
          else if (name === "find_related_work") value = { related_work: (await runtime.search(bearer(request), { query: String(args.task), repository: args.repository ? String(args.repository) : undefined, limit: args.limit ? Number(args.limit) : 5 })).results };
          else if (name === "get_pr_trace") value = await runtime.getPullRequestTrace(bearer(request), String(args.repository), Number(args.pull_request));
          else if (name === "prepare_trace_enrichment") value = await runtime.prepareTraceEnrichment(bearer(request), String(args.trace_id));
          else if (name === "save_trace_enrichment") value = await runtime.cacheTraceEnrichment(bearer(request), { traceId: String(args.trace_id), title: String(args.title), summary: String(args.summary), stages: args.stages as never, outcome: args.outcome as never, model: args.model ? String(args.model) : undefined, promptVersion: String(args.prompt_version) });
          else if (name === "get_usage") value = await runtime.usage(bearer(request), { repository: args.repository ? String(args.repository) : undefined });
          else if (name === "share_trace") {
            const action = String(args.action ?? "preview");
            if (action === "revoke") value = await runtime.revokeShare(bearer(request), String(args.share_id));
            else if (action === "confirm") value = await runtime.createShare(bearer(request), await runtime.consumeMutation(bearer(request), String(args.confirmation_token), "share.create"));
            else value = await runtime.prepareMutation(bearer(request), "share.create", { traceId: String(args.trace_id), content: String(args.content ?? "overview"), audience: String(args.audience ?? "anyone_with_link"), expiresAt: args.expires_at ? String(args.expires_at) : undefined, agentRetrieve: true, allowContext: false, allowSkillCreation: false });
          }
          else if (name === "list_skills") value = await runtime.listSkills(bearer(request), args.query ? String(args.query) : "");
          else if (name === "get_skill") value = await runtime.getSkill(bearer(request), String(args.skill_id));
          else if (name === "create_skill") {
            if (args.action === "confirm") value = await runtime.createSkill(bearer(request), await runtime.consumeMutation(bearer(request), String(args.confirmation_token), "skill.create"));
            else value = await runtime.prepareMutation(bearer(request), "skill.create", { name: String(args.name), description: args.description ? String(args.description) : "", traceIds: args.source_trace_ids as string[], instructions: args.instructions as string[], validation: [], visibility: "private" });
          }
          else throw new Error("Unknown tool"); result = { content: [{ type: "text", text: JSON.stringify(value) }] };
        }
        else throw new Error("Method not found"); return send(response, 200, { jsonrpc: "2.0", id: rpc.id, result });
      }
      return send(response, 404, { error: "Not found" });
    } catch (error) { const message = error instanceof Error ? error.message : String(error); const status = /Unauthorized|access denied|inaccessible/.test(message) ? 401 : /not found|revoked/i.test(message) ? 404 : /Invalid|required|expired|usage limit|too large/.test(message) ? 400 : 500; return send(response, status, { error: status === 500 ? "Internal server error" : message }); }
  });
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync, gunzipSync } from "node:zlib";
import { verifyDeviceSignature, type JsonRpcRequest, type NativeEnvelope } from "@agenttraces/core";
import type { CloudRuntime } from "./runtime.js";

function send(response: ServerResponse, status: number, value: unknown) { const body = JSON.stringify(value); response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" }); response.end(body); }
async function readBody(request: IncomingMessage, max = 20 * 1024 * 1024) { const chunks: Buffer[] = []; let size = 0; for await (const part of request) { const chunk = Buffer.from(part as Uint8Array); size += chunk.length; if (size > max) throw new Error("Request too large"); chunks.push(chunk); } return Buffer.concat(chunks); }
function bearer(request: IncomingMessage) { const value = request.headers.authorization; return value?.startsWith("Bearer ") ? value.slice(7) : ""; }

export function createCloudApi(runtime: CloudRuntime) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { status: await runtime.health() ? "ok" : "degraded", service: "agenttraces-api", version: "0.1.0" });
      if (request.method === "POST" && url.pathname === "/v1/devices/register") return send(response, 201, await runtime.registerDevice(JSON.parse((await readBody(request, 128 * 1024)).toString("utf8"))));
      if (request.method === "POST" && url.pathname === "/v1/claim") { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 200, await runtime.claim(bearer(request), value.email, value.name)); }
      if (request.method === "POST" && url.pathname === "/v1/teams") { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 201, await runtime.createTeam(bearer(request), value.slug, value.defaultVisibility)); }
      if (request.method === "PATCH" && /^\/v1\/teams\/[^/]+\/policy$/.test(url.pathname)) { const value = JSON.parse((await readBody(request, 32 * 1024)).toString("utf8")); return send(response, 200, await runtime.setTeamPolicy(bearer(request), decodeURIComponent(url.pathname.split("/")[3]!), value.defaultVisibility)); }
      if (request.method === "POST" && url.pathname === "/v1/ingest") {
        const wire = await readBody(request); const raw = request.headers["content-encoding"] === "gzip" ? gunzipSync(wire) : wire;
        const signature = String(request.headers["x-agenttraces-signature"] ?? ""); const deviceId = String(request.headers["x-agenttraces-device-id"] ?? ""); const device = await runtime.device(deviceId);
        if (!device || !verifyDeviceSignature(device.public_key, raw.toString("base64"), signature)) return send(response, 401, { error: "Invalid device signature" });
        const payload = JSON.parse(raw.toString("utf8")) as { batchId: string; envelopes: NativeEnvelope[] };
        const namespaceId = String(request.headers["x-agenttraces-namespace-id"] ?? device.namespace_id);
        return send(response, 202, await runtime.acceptBatch(deviceId, namespaceId, payload.batchId, request.headers["content-encoding"] === "gzip" ? wire : gzipSync(raw), payload.envelopes.length));
      }
      if (request.method === "POST" && url.pathname === "/v1/search") return send(response, 200, await runtime.search(bearer(request), JSON.parse((await readBody(request, 128 * 1024)).toString("utf8"))));
      if (request.method === "GET" && url.pathname.startsWith("/v1/traces/")) return send(response, 200, await runtime.getTrace(bearer(request), decodeURIComponent(url.pathname.slice(11)), url.searchParams.get("view") ?? "summary"));
      if (request.method === "POST" && url.pathname === "/mcp") {
        const rpc = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8")) as JsonRpcRequest; let result: unknown;
        if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agenttraces-cloud", version: "0.1.0" } };
        else if (rpc.method === "tools/list") result = { tools: [{ name: "search_traces", description: "Search authorized historical agent traces", inputSchema: { type: "object", properties: { query: { type: "string" }, repository: { type: "string" }, source: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false } }, { name: "get_trace", description: "Get one authorized trace", inputSchema: { type: "object", properties: { trace_id: { type: "string" }, view: { type: "string" } }, required: ["trace_id"], additionalProperties: false } }] };
        else if (rpc.method === "tools/call") { const name = String(rpc.params?.name); const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>; const value = name === "search_traces" ? await runtime.search(bearer(request), args as never) : name === "get_trace" ? await runtime.getTrace(bearer(request), String(args.trace_id), String(args.view ?? "summary")) : (() => { throw new Error("Unknown tool"); })(); result = { content: [{ type: "text", text: JSON.stringify(value) }] }; }
        else throw new Error("Method not found"); return send(response, 200, { jsonrpc: "2.0", id: rpc.id, result });
      }
      return send(response, 404, { error: "Not found" });
    } catch (error) { const message = error instanceof Error ? error.message : String(error); return send(response, /Unauthorized|inaccessible/.test(message) ? 401 : /Invalid|required|too large/.test(message) ? 400 : 500, { error: message }); }
  });
}

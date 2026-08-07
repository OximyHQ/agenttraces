import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import type { NativeEnvelope, SearchRequest } from "./contracts.js";
import { verifyDeviceSignature } from "./crypto.js";
import { AgentTracesStore } from "./store.js";

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array); size += buffer.length;
    if (size > 20 * 1024 * 1024) throw new Error("Request exceeds 20MB");
    chunks.push(buffer);
  }
  const combined = Buffer.concat(chunks);
  return request.headers["content-encoding"] === "gzip" ? gunzipSync(combined) : combined;
}

export interface ApiOptions { queryToken?: string; workerToken?: string }

export function createAgentTracesApi(store: AgentTracesStore, options: ApiOptions = {}): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return send(response, 200, { status: "ok", service: "agenttraces-api", version: "0.2.0" });
      }
      if (request.method === "POST" && url.pathname === "/v1/devices/register") {
        const payload = JSON.parse((await body(request)).toString("utf8")) as { deviceId: string; publicKey: string; name?: string };
        return send(response, 201, store.registerDevice(payload.deviceId, payload.publicKey, payload.name));
      }
      if (request.method === "POST" && url.pathname === "/v1/ingest") {
        const bytes = await body(request);
        const signature = request.headers["x-agenttraces-signature"];
        const deviceId = request.headers["x-agenttraces-device-id"];
        const device = typeof deviceId === "string" ? store.device(deviceId) : undefined;
        if (!device || typeof signature !== "string" || !verifyDeviceSignature(device.publicKey, bytes.toString("base64"), signature)) return send(response, 401, { error: "Invalid device signature" });
        const payload = JSON.parse(bytes.toString("utf8")) as { batchId: string; envelopes: NativeEnvelope[] };
        return send(response, 202, store.enqueue(payload.batchId, payload.envelopes, device.id));
      }
      if (request.method === "POST" && url.pathname === "/v1/process") {
        if (!options.workerToken || request.headers.authorization !== `Bearer ${options.workerToken}`) return send(response, 401, { error: "Worker authorization required" });
        return send(response, 200, store.processPending());
      }
      if (request.method === "POST" && url.pathname === "/v1/search") {
        if (!options.queryToken || request.headers.authorization !== `Bearer ${options.queryToken}`) return send(response, 401, { error: "Query authorization required" });
        const payload = JSON.parse((await body(request)).toString("utf8")) as SearchRequest;
        return send(response, 200, { results: store.search(payload) });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/traces/")) {
        if (!options.queryToken || request.headers.authorization !== `Bearer ${options.queryToken}`) return send(response, 401, { error: "Query authorization required" });
        const traceId = decodeURIComponent(url.pathname.slice("/v1/traces/".length));
        const view = (url.searchParams.get("view") ?? "summary") as "metadata" | "summary" | "full_transcript" | "commands" | "files" | "usage";
        return send(response, 200, store.getTrace(traceId, store.actor(), view));
      }
      return send(response, 404, { error: "Not found" });
    } catch (error) {
      return send(response, error instanceof SyntaxError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export async function listen(server: Server, port = 0, host = "127.0.0.1") {
  await new Promise<void>((resolve, reject) => server.listen(port, host, resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API did not bind a TCP port");
  return { host, port: address.port, url: `http://${host}:${address.port}` };
}

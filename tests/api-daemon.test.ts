import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import test from "node:test";
import { AgentTracesDaemon, AgentTracesStore, createAgentTracesApi, listen } from "../packages/core/src/index.js";
import { temporary, write } from "./helpers.js";

test("remote API registers a device, verifies its signature, durably ingests, and preserves tenant ownership", async () => {
  const temp = temporary();
  let client: AgentTracesStore | undefined; let cloud: AgentTracesStore | undefined; let server: ReturnType<typeof createAgentTracesApi> | undefined;
  try {
    const userHome = `${temp.path}/user`; mkdirSync(userHome, { recursive: true });
    write(`${userHome}/.codex/sessions/2026/08/04/session.jsonl`, `${JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: "remote sentinel" } })}\n`);
    client = new AgentTracesStore(`${temp.path}/client/db.sqlite`, `${temp.path}/client`); cloud = new AgentTracesStore(`${temp.path}/cloud/db.sqlite`, `${temp.path}/cloud`);
    server = createAgentTracesApi(cloud); const address = await listen(server);
    const result = await new AgentTracesDaemon(client, userHome).upload(address.url, { sources: ["codex"], fromBeginning: true });
    assert.equal((result.receipt as { accepted: number }).accepted, 1); assert.equal(cloud.processPending().processed, 1);
    const remoteDevice = cloud.device(client.installation().deviceId)!; const actor = { principalId: remoteDevice.principalId, teamIds: [] };
    const traces = cloud.search({ query: "remote sentinel" }, actor); assert.equal(traces.length, 1); assert.equal(traces[0]?.namespaceId, remoteDevice.namespaceId);
    assert.notEqual(traces[0]?.ownerId, cloud.installation().principalId);

    const tampered = await fetch(`${address.url}/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", "x-agenttraces-device-id": client.installation().deviceId, "x-agenttraces-signature": "invalid" }, body: JSON.stringify({ batchId: "tampered", envelopes: [] }) });
    assert.equal(tampered.status, 401);
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()); client?.close(); cloud?.close(); temp.cleanup();
  }
});

test("API health, authorization, parse errors, and unknown routes have stable status codes", async () => {
  const temp = temporary(); const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path); const server = createAgentTracesApi(store, { queryToken: "query-test", workerToken: "worker-test" });
  try {
    const address = await listen(server); assert.equal((await fetch(`${address.url}/health`)).status, 200);
    assert.equal((await fetch(`${address.url}/v1/search`, { method: "POST", body: "{}" })).status, 401);
    const malformed = await fetch(`${address.url}/v1/search`, { method: "POST", headers: { authorization: "Bearer query-test" }, body: "{" });
    assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: "Invalid JSON" });
    const internal = await fetch(`${address.url}/v1/devices/register`, { method: "POST", body: JSON.stringify({ deviceId: "invalid", publicKey: "secret-internal-detail" }) });
    assert.equal(internal.status, 500); assert.deepEqual(await internal.json(), { error: "Internal server error" });
    assert.equal((await fetch(`${address.url}/v1/process`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${address.url}/v1/process`, { method: "POST", headers: { authorization: "Bearer worker-test" } })).status, 200);
    assert.equal((await fetch(`${address.url}/missing`)).status, 404);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); temp.cleanup(); }
});

test("continuous daemon loop retries failures and stops on abort", async () => {
  const temp = temporary();
  try {
    mkdirSync(`${temp.path}/user`, { recursive: true }); const store = new AgentTracesStore(`${temp.path}/state/db.sqlite`, `${temp.path}/state`); const daemon = new AgentTracesDaemon(store, `${temp.path}/user`); const controller = new AbortController();
    let cycles = 0; const result = await daemon.runLoop({ intervalMs: 1, signal: controller.signal, onCycle: () => { cycles++; if (cycles === 2) controller.abort(); } });
    assert.equal(result.cycles, 2); assert.equal(result.stopped, true); store.close();
  } finally { temp.cleanup(); }
});

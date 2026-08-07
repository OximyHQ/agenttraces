import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createCloudApi, type CloudRuntime } from "../packages/cloud/src/index.js";

test("cloud API routes team onboarding, trace enrichment, PR linkage, and public snapshots", async () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const value = (name: string, result: unknown) => async (...args: unknown[]) => { calls.push({ name, args }); return result; };
  const runtime = {
    config: { githubWebhookSecret: "webhook-test-secret" },
    exchangeWebIdentity: value("exchangeWebIdentity", { accessToken: "web-token" }),
    listTeams: value("listTeams", { teams: [] }),
    createSetupLink: value("createSetupLink", { url: "/join/setup-token" }),
    listTeamDevices: value("listTeamDevices", { devices: [] }),
    prepareTraceEnrichment: value("prepareTraceEnrichment", { promptVersion: "trace-summary-v1" }),
    cacheTraceEnrichment: value("cacheTraceEnrichment", { provider: "local_subscription" }),
    linkTraceToPullRequest: value("linkTraceToPullRequest", { pullRequestId: "pr_1" }),
    getPullRequestTrace: value("getPullRequestTrace", { traces: [] }),
    createShare: value("createShare", { url: "/t/share-token", snapshot: true }),
    prepareMutation: value("prepareMutation", { status: "confirmation_required", confirmationToken: "confirm-token" }),
    getShare: value("getShare", { snapshot: true, events: [] }),
    handleGitHubWebhook: value("handleGitHubWebhook", { accepted: true, linked: true }),
  } as unknown as CloudRuntime;
  const server = createCloudApi(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo; const base = `http://127.0.0.1:${port}`;
  try {
    const auth = { authorization: "Bearer device-token", "content-type": "application/json" };
    assert.equal((await fetch(`${base}/v1/auth/exchange`, { method: "POST", headers: { "content-type": "application/json", "x-agenttraces-web-secret": "service-secret" }, body: JSON.stringify({ userId: "user_1", email: "user@example.com" }) })).status, 200);
    assert.equal((await fetch(`${base}/v1/teams`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/v1/teams/team_1/setup-links`, { method: "POST", headers: auth, body: JSON.stringify({ maxUses: 4 }) })).status, 201);
    assert.equal((await fetch(`${base}/v1/teams/team_1/devices`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/v1/traces/trace_1/enrichment/prepare`, { method: "POST", headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/v1/traces/trace_1/enrichment`, { method: "PUT", headers: auth, body: JSON.stringify({ title: "Trace" }) })).status, 200);
    assert.equal((await fetch(`${base}/v1/traces/trace_1/pull-requests`, { method: "POST", headers: auth, body: JSON.stringify({ repository: "https://github.com/OximyHQ/agenttraces", number: 7 }) })).status, 201);
    assert.equal((await fetch(`${base}/v1/traces/trace_1/shares`, { method: "POST", headers: auth, body: JSON.stringify({ content: "overview" }) })).status, 201);
    const publicShare = await fetch(`${base}/v1/public/shares/share-token`);
    assert.equal(publicShare.status, 200); assert.equal((await publicShare.json() as { snapshot: boolean }).snapshot, true);
    const toolsResponse = await fetch(`${base}/mcp`, { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const tools = await toolsResponse.json() as { result: { tools: Array<{ name: string }> } };
    assert.equal(tools.result.tools.length, 12); assert.ok(tools.result.tools.some((tool) => tool.name === "share_trace"));
    const sharePreview = await fetch(`${base}/mcp`, { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "share_trace", arguments: { action: "preview", trace_id: "trace_1", content: "overview", audience: "anyone_with_link" } } }) });
    assert.equal(sharePreview.status, 200); assert.match(JSON.stringify(await sharePreview.json()), /confirmation_required/);
    const webhookBody = JSON.stringify({ installation: { id: 123 }, action: "opened" }); const signature = `sha256=${createHmac("sha256", "webhook-test-secret").update(webhookBody).digest("hex")}`;
    assert.equal((await fetch(`${base}/v1/github/webhooks`, { method: "POST", headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-hub-signature-256": signature }, body: webhookBody })).status, 202);
    assert.equal((await fetch(`${base}/v1/github/webhooks`, { method: "POST", headers: { "x-github-event": "pull_request", "x-hub-signature-256": "sha256=bad" }, body: webhookBody })).status, 401);
    assert.deepEqual(calls.map((call) => call.name), ["exchangeWebIdentity", "listTeams", "createSetupLink", "listTeamDevices", "prepareTraceEnrichment", "cacheTraceEnrichment", "linkTraceToPullRequest", "createShare", "getShare", "prepareMutation", "handleGitHubWebhook"]);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

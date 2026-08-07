import assert from "node:assert/strict";
import test from "node:test";
import { AgentTracesMcp, AgentTracesStore, MCP_TOOLS, handleMcpMessage } from "../packages/core/src/index.js";
import { envelope, temporary } from "./helpers.js";

test("MCP exposes bounded retrieval, local-enrichment, and confirmed mutation tools over JSON-RPC", () => {
  assert.equal(MCP_TOOLS.length, 12); assert.equal(new Set(MCP_TOOLS.map((tool) => tool.name)).size, 12);
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path); const local = envelope("codex", "session_transcript", { type: "response_item", payload: { type: "message", role: "user", content: "MCP sentinel" } }, { device_id: store.installation().deviceId, session_id: "mcp" });
    store.enqueue("batch", [local]); store.processPending(); const server = new AgentTracesMcp(store); const traceId = store.listTraces()[0]!.id;
    const initialized = handleMcpMessage(server, { jsonrpc: "2.0", id: 1, method: "initialize" }) as { result: { serverInfo: { name: string } } }; assert.equal(initialized.result.serverInfo.name, "agenttraces");
    const tools = handleMcpMessage(server, { jsonrpc: "2.0", id: 2, method: "tools/list" }) as { result: { tools: unknown[] } }; assert.equal(tools.result.tools.length, 12);
    const search = server.call("search_traces", { query: "MCP sentinel" }) as { results: unknown[] }; assert.equal(search.results.length, 1);
    const related = server.call("find_related_work", { task: "sentinel" }) as { related_work: unknown[] }; assert.equal(related.related_work.length, 1);
    const prepared = server.call("prepare_trace_enrichment", { trace_id: traceId }) as { promptVersion: string };
    const enriched = server.call("save_trace_enrichment", { trace_id: traceId, title: "Trace via MCP", summary: "Summarized with the active subscription.", stages: [{ kind: "outcome", text: "Finished." }], outcome: "completed", prompt_version: prepared.promptVersion }) as { provider: string };
    assert.equal(enriched.provider, "local_subscription");
    const sharePreview = server.call("share_trace", { action: "preview", trace_id: traceId, content: "summary", audience: "anyone_with_link" }) as { confirmationToken: string };
    assert.equal(store.listShares().length, 0); const share = server.call("share_trace", { action: "confirm", confirmation_token: sharePreview.confirmationToken }) as { id: string }; assert.ok(share.id); assert.equal(store.listShares().length, 1);
    assert.throws(() => server.call("share_trace", { action: "confirm", confirmation_token: sharePreview.confirmationToken }), /already been used/);
    const skillPreview = server.call("create_skill", { name: "mcp-skill", description: "fixture", source_trace_ids: [traceId], instructions: ["Use evidence"] }) as { confirmationToken: string };
    const skill = server.call("create_skill", { action: "confirm", confirmation_token: skillPreview.confirmationToken }) as { name: string }; assert.equal(skill.name, "mcp-skill");
    const missing = handleMcpMessage(server, { jsonrpc: "2.0", id: 3, method: "unknown" }) as { error: { code: number } }; assert.equal(missing.error.code, -32000);
    store.close();
  } finally { temp.cleanup(); }
});

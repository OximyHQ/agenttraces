import type { AgentTracesStore } from "./store.js";
import { createInterface } from "node:readline";

type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
type Input = Record<string, unknown>;

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };

export const MCP_TOOLS: Tool[] = [
  { name: "search_traces", description: "Search accessible prior coding-agent traces with provenance.", inputSchema: objectSchema({ query: string, scope: { type: "string", enum: ["mine", "team", "shared_with_me", "all_accessible"] }, repository: string, limit: { type: "number" } }, ["query"]) },
  { name: "get_trace", description: "Retrieve one accessible trace view.", inputSchema: objectSchema({ trace_id: string, view: { type: "string", enum: ["metadata", "summary", "full_transcript", "commands", "files", "usage"] } }, ["trace_id"]) },
  { name: "get_current_trace", description: "Return the most recently active accessible trace.", inputSchema: objectSchema({ view: string }) },
  { name: "find_related_work", description: "Find prior work related to the current task.", inputSchema: objectSchema({ task: string, repository: string, limit: { type: "number" } }, ["task"]) },
  { name: "get_pr_trace", description: "Retrieve traces linked to a pull request.", inputSchema: objectSchema({ repository: string, pull_request: { type: "number" } }, ["repository", "pull_request"]) },
  { name: "get_usage", description: "Return accessible session and token usage with accuracy state.", inputSchema: objectSchema({ repository: string, source: string }) },
  { name: "share_trace", description: "Preview, confirm, or revoke a permissioned share. Confirmation requires the single-use token returned by preview.", inputSchema: objectSchema({ action: { type: "string", enum: ["preview", "confirm", "revoke"] }, trace_id: string, content: string, audience: string, confirmation_token: string, share_id: string, expires_at: string }) },
  { name: "list_skills", description: "List accessible reusable skills.", inputSchema: objectSchema({ query: string }) },
  { name: "get_skill", description: "Retrieve one accessible skill with provenance.", inputSchema: objectSchema({ skill_id: string }, ["skill_id"]) },
  { name: "create_skill", description: "Preview or confirm creation of a skill from traces using a single-use confirmation token.", inputSchema: objectSchema({ action: { type: "string", enum: ["preview", "confirm"] }, name: string, description: string, source_trace_ids: { type: "array", items: string }, instructions: { type: "array", items: string }, confirmation_token: string }) },
];

function required(input: Input, key: string) {
  const value = input[key];
  if (value === undefined || value === null || value === "") throw new Error(`Missing ${key}`);
  return value;
}

export class AgentTracesMcp {
  constructor(readonly store: AgentTracesStore) {}

  listTools() { return MCP_TOOLS; }

  call(name: string, input: Input = {}) {
    switch (name) {
      case "search_traces": return { results: this.store.search({ query: String(required(input, "query")), scope: input.scope as never, repository: input.repository ? String(input.repository) : undefined, limit: input.limit ? Number(input.limit) : undefined }) };
      case "get_trace": return this.store.getTrace(String(required(input, "trace_id")), this.store.actor(), (input.view ? String(input.view) : "summary") as never);
      case "get_current_trace": return this.store.current();
      case "find_related_work": return { related_work: this.store.search({ query: String(required(input, "task")), repository: input.repository ? String(input.repository) : undefined, limit: input.limit ? Number(input.limit) : 5 }).map((trace) => ({ ...trace, reason: "Matched accessible trace evidence" })) };
      case "get_pr_trace": {
        const repository = String(required(input, "repository")); const pullRequest = Number(required(input, "pull_request"));
        const traces = this.store.listTraces().filter((trace) => trace.repository === repository && trace.pullRequest === pullRequest);
        return { repository, pull_request: pullRequest, sessions: traces, usage: { inputTokens: traces.reduce((sum, trace) => sum + trace.inputTokens, 0), outputTokens: traces.reduce((sum, trace) => sum + trace.outputTokens, 0) } };
      }
      case "get_usage": return this.store.usage(this.store.actor(), { repository: input.repository ? String(input.repository) : undefined, source: input.source as never });
      case "share_trace": {
        const action = input.action ? String(input.action) : "preview";
        if (action === "revoke") return this.store.revokeShare(String(required(input, "share_id")));
        if (action === "confirm") return this.store.createShare(this.store.consumeMutation(String(required(input, "confirmation_token")), "share.create"));
        const preview = { traceId: String(required(input, "trace_id")), content: String(required(input, "content")), audience: String(required(input, "audience")), expiresAt: input.expires_at ? String(input.expires_at) : undefined, agentRetrieve: true, allowContext: false, allowSkillCreation: false };
        return { status: "confirmation_required", ...this.store.prepareMutation("share.create", preview) };
      }
      case "list_skills": return { skills: this.store.listSkills(this.store.actor(), input.query ? String(input.query) : "") };
      case "get_skill": return this.store.getSkill(String(required(input, "skill_id")));
      case "create_skill": {
        if (input.action === "confirm") return this.store.createSkill(this.store.consumeMutation(String(required(input, "confirmation_token")), "skill.create"));
        const preview = { name: String(required(input, "name")), description: input.description ? String(input.description) : "", traceIds: required(input, "source_trace_ids") as string[], instructions: required(input, "instructions") as string[] };
        return { status: "confirmation_required", ...this.store.prepareMutation("skill.create", preview) };
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
}

export interface JsonRpcRequest { jsonrpc: "2.0"; id?: string | number; method: string; params?: Input }

export function handleMcpMessage(server: AgentTracesMcp, request: JsonRpcRequest) {
  try {
    let result: unknown;
    if (request.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agenttraces", version: "0.1.0" } };
    else if (request.method === "notifications/initialized") return null;
    else if (request.method === "tools/list") result = { tools: server.listTools() };
    else if (request.method === "tools/call") {
      const name = String(request.params?.name ?? ""); const args = (request.params?.arguments ?? {}) as Input;
      result = { content: [{ type: "text", text: JSON.stringify(server.call(name, args)) }], isError: false };
    } else if (request.method === "ping") result = {};
    else throw new Error(`Method not found: ${request.method}`);
    return request.id === undefined ? null : { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    return request.id === undefined ? null : { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
  }
}

export function runMcpStdio(store: AgentTracesStore): Promise<void> {
  const server = new AgentTracesMcp(store);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  return new Promise((resolve) => {
    lines.on("line", (line) => {
      try {
        const response = handleMcpMessage(server, JSON.parse(line) as JsonRpcRequest);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } })}\n`);
      }
    });
    lines.once("close", resolve);
  });
}

export function runRemoteMcpStdio(endpoint: string, accessToken: string): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  return new Promise((resolve) => {
    lines.on("line", async (line) => {
      try {
        const response = await fetch(`${endpoint.replace(/\/$/, "")}/mcp`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: line });
        const output = await response.text();
        process.stdout.write(`${response.ok ? output : JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: output } })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })}\n`);
      }
    });
    lines.once("close", resolve);
  });
}

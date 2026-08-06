import { demoTraces, type TraceEvent, type TraceRecord } from "./product-data";

async function bindings() {
  return process.env as Record<string, string | undefined>;
}

async function cloudCredentials() {
  const config = await bindings(); const endpoint = config.AGENTTRACES_API_URL;
  if (!endpoint) return null;
  const [{ headers }, { getAuth }] = await Promise.all([import("next/headers"), import("./auth")]);
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) { const { redirect } = await import("next/navigation"); redirect("/sign-in"); }
  if (config.AGENTTRACES_API_TOKEN) return { endpoint, token: config.AGENTTRACES_API_TOKEN };
  if (!config.AGENTTRACES_WEB_AUTH_SECRET) throw new Error("AGENTTRACES_WEB_AUTH_SECRET is required when the cloud API is configured");
  const exchange = await fetch(`${endpoint.replace(/\/$/, "")}/v1/auth/exchange`, { method: "POST", headers: { "content-type": "application/json", "x-agenttraces-web-secret": config.AGENTTRACES_WEB_AUTH_SECRET }, body: JSON.stringify({ userId: session.user.id, email: session.user.email, name: session.user.name }), cache: "no-store" });
  if (!exchange.ok) throw new Error(`AgentTraces identity exchange returned ${exchange.status}`);
  return { endpoint, token: String((await exchange.json() as { accessToken: string }).accessToken) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const cloud = await cloudCredentials(); if (!cloud) return null;
  const response = await fetch(`${cloud.endpoint.replace(/\/$/, "")}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers, authorization: `Bearer ${cloud.token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`AgentTraces API returned ${response.status}`);
  return response.json() as Promise<T>;
}

function sourceName(value: string) { return ({ claude_code: "Claude Code", copilot: "GitHub Copilot", codex: "Codex", cursor: "Cursor", openclaw: "OpenClaw", conductor: "Conductor", antigravity: "Antigravity" } as Record<string, string>)[value] ?? value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }
const eventKinds = new Set<TraceEvent["kind"]>(["user", "assistant", "system", "reasoning", "tool_call", "tool_result", "command", "file", "usage", "metadata", "lifecycle", "error"]);
const eventLabels: Record<TraceEvent["kind"], string> = { user: "User", assistant: "Agent", system: "System", reasoning: "Reasoning", tool_call: "Tool call", tool_result: "Tool result", command: "Command", file: "File activity", usage: "Usage", metadata: "Metadata", lifecycle: "Lifecycle", error: "Error" };

export function mapEvent(row: Record<string, unknown>): TraceEvent {
  const rawKind = String(row.kind); const kind = eventKinds.has(rawKind as TraceEvent["kind"]) ? rawKind as TraceEvent["kind"] : "metadata";
  const operation = row.operation_kind ? String(row.operation_kind) as TraceEvent["operation"] : undefined;
  const detailValue = row.output ?? row.input;
  return { id: String(row.id), time: new Date(String(row.timestamp)).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false }), kind, operation, status: row.operation_status ? String(row.operation_status) : undefined, label: String(row.purpose ?? (operation ? operation.replaceAll("_", " ") : eventLabels[kind])), content: String(row.content ?? row.command ?? row.tool_name ?? eventLabels[kind]), detail: detailValue == null ? undefined : typeof detailValue === "string" ? detailValue : JSON.stringify(detailValue, null, 2), duration: row.duration_ms ? `${Number(row.duration_ms) / 1000}s` : undefined };
}
function mapTrace(row: Record<string, unknown>): TraceRecord {
  const pullRequests = (row.pull_requests ?? []) as Array<Record<string, unknown>>; const eventRows = (row.events ?? []) as Array<Record<string, unknown>>;
  const model = row.model ?? eventRows.find((event) => event.model)?.model;
  return { id: String(row.id), title: String(row.title), summary: String(row.summary ?? "No summary has been generated yet."), source: sourceName(String(row.source)), model: model ? String(model) : undefined, repository: String(row.repository ?? "No repository"), branch: String(row.branch ?? "—"), owner: String(row.owner_name ?? row.owner_email ?? "You"), updated: new Date(String(row.updated_at)).toLocaleString(), duration: "—", events: Number(row.event_count ?? 0), tokens: new Intl.NumberFormat("en", { notation: "compact" }).format(Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0)), cost: row.cost_accuracy === "subscription_included" ? "Included" : row.cost_usd == null ? "Unavailable" : `$${Number(row.cost_usd).toFixed(2)}`, costAccuracy: String(row.cost_accuracy ?? "unavailable").replaceAll("_", " "), pullRequests: pullRequests.map((pr) => ({ number: Number(pr.number), title: String(pr.title ?? "Pull request"), state: String(pr.state ?? "unknown"), evidence: String(pr.evidence ?? "unknown") })), stages: ((row.stages ?? []) as TraceRecord["stages"]), timeline: eventRows.map(mapEvent) };
}

export async function traces() {
  const cloud = await request<{ traces: Record<string, unknown>[] }>("/v1/traces?limit=50");
  return cloud ? { records: cloud.traces.map(mapTrace), preview: false } : { records: demoTraces, preview: true };
}

export async function trace(traceId: string) {
  const cloud = await request<Record<string, unknown>>(`/v1/traces/${encodeURIComponent(traceId)}?view=full_transcript`);
  return cloud ? { record: mapTrace(cloud), preview: false } : { record: demoTraces.find((item) => item.id === traceId) ?? demoTraces[0]!, preview: true };
}

export async function publicShare(shareToken: string) {
  const config = await bindings(); const endpoint = config.AGENTTRACES_API_URL;
  if (!endpoint) return { trace: demoTraces[0], events: demoTraces[0].timeline, snapshot: true, preview: true };
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/public/shares/${encodeURIComponent(shareToken)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json() as Record<string, unknown>;
  return { ...payload, trace: mapTrace({ ...(payload.trace as object), events: payload.events }), events: (payload.events as Array<Record<string, unknown>>).map(mapEvent), preview: false };
}

export async function createTraceShare(traceId: string, spec: Record<string, unknown>) {
  return request<{ url: string; snapshot: boolean }>(`/v1/traces/${encodeURIComponent(traceId)}/shares`, { method: "POST", body: JSON.stringify({ ...spec, traceId }) });
}

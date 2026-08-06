export type OperationKind = "file_read" | "file_write" | "file_edit" | "repository_search" | "command_run" | "test_run" | "web_search" | "web_fetch" | "mcp_call" | "agent_spawn" | "agent_message" | "agent_complete" | "git_status" | "git_commit" | "git_push" | "generic_tool";
export type TraceEventKind = "user" | "assistant" | "system" | "reasoning" | "tool_call" | "tool_result" | "command" | "file" | "usage" | "metadata" | "lifecycle" | "error";

export interface TraceEvent {
  id: string;
  time: string;
  kind: TraceEventKind;
  label?: string;
  operation?: OperationKind;
  content: string;
  detail?: string;
  duration?: string;
  status?: string;
}

export interface TraceRecord {
  id: string;
  title: string;
  summary: string;
  source: string;
  model?: string;
  repository: string;
  branch: string;
  owner: string;
  updated: string;
  duration: string;
  events: number;
  tokens: string;
  cost: string;
  costAccuracy: string;
  pullRequests: Array<{ number: number; title: string; state: string; evidence: string }>;
  stages: Array<{ title: string; text: string }>;
  timeline: TraceEvent[];
}

export const demoTraces: TraceRecord[] = [
  {
    id: "tr_01K2X9W4C7Q2",
    title: "Connect trace search to pull requests",
    summary: "Added explicit and evidence-based PR links, aggregated every contributing coding session, and verified retrieval through the CLI and MCP server.",
    source: "Codex",
    model: "GPT-5.6",
    repository: "OximyHQ/agenttraces",
    branch: "feat/pr-traces",
    owner: "Naman",
    updated: "8 min ago",
    duration: "42m",
    events: 126,
    tokens: "184k",
    cost: "Included",
    costAccuracy: "Subscription usage; no per-request charge reported",
    pullRequests: [{ number: 7, title: "Connect traces to pull requests", state: "open", evidence: "Exact commit + manual confirmation" }],
    stages: [
      { title: "Understand", text: "Mapped the existing scalar PR field and found where session Git metadata enters the collector." },
      { title: "Build", text: "Added repository, commit, pull request, and trace-link records with confidence and evidence." },
      { title: "Verify", text: "Exercised two traces linked to the same pull request through store, CLI, and MCP tests." },
      { title: "Outcome", text: "PR #7 now shows every linked trace and an aggregate token and cost-accuracy view." },
    ],
    timeline: [
      { id: "evt_01", time: "10:42", kind: "user", content: "Implement many-to-many PR linkage and make the complete work history easy to retrieve." },
      { id: "evt_02", time: "10:43", kind: "assistant", content: "I’ll trace the current git metadata path, preserve compatibility, and add explicit provenance for every inferred link." },
      { id: "evt_03", time: "10:44", kind: "tool_call", operation: "repository_search", label: "Searched repository", content: "pull_request | canonicalRepository | inspectGit", detail: "packages/core/src · apps/cli/src", duration: "0.3s" },
      { id: "evt_04", time: "10:48", kind: "file", operation: "file_edit", label: "Edited 4 files", content: "Added repositories, pull_requests, trace_commits, and trace_pull_requests.", detail: "+214 −18", duration: "2m" },
      { id: "evt_05", time: "10:53", kind: "tool_result", operation: "agent_spawn", label: "Sub-agent completed", content: "Reviewed the trace-to-PR attribution model for ambiguous branch and time overlap.", detail: "1 child trace", duration: "4m" },
      { id: "evt_06", time: "11:02", kind: "tool_result", operation: "test_run", label: "Tests passed", content: "pnpm exec tsx --test tests/store.test.ts tests/mcp.test.ts", detail: "10 passed", duration: "1.8s" },
      { id: "evt_07", time: "11:04", kind: "assistant", content: "PR linkage is complete. Exact commits rank highest, inferred links retain confidence, and manual confirmation is visible in the trace." },
    ],
  },
  {
    id: "tr_01K2X3B8M1P4",
    title: "Harden immutable public trace shares",
    summary: "Created point-in-time share snapshots with bounded views, expiry, revocation, and access accounting.",
    source: "Claude Code", model: "Claude Opus 4.1", repository: "OximyHQ/agenttraces", branch: "feat/shares", owner: "Aisha", updated: "34 min ago", duration: "28m", events: 84, tokens: "96k", cost: "$1.82", costAccuracy: "Estimated from reported tokens",
    pullRequests: [{ number: 7, title: "Connect traces to pull requests", state: "open", evidence: "Branch and repository" }],
    stages: [{ title: "Outcome", text: "External links now preserve exactly what the owner chose at share time." }], timeline: [],
  },
  {
    id: "tr_01K2V7N6R2S9",
    title: "Investigate queue timeout during backfill",
    summary: "Identified a worker visibility timeout caused by parsing large session batches and bounded the batch size.",
    source: "Cursor", model: "Not reported", repository: "OximyHQ/collector", branch: "fix/backfill-timeout", owner: "Luis", updated: "Yesterday", duration: "1h 08m", events: 211, tokens: "302k", cost: "Unavailable", costAccuracy: "The source did not report cost", pullRequests: [], stages: [], timeline: [],
  },
];

export const demoTeam = {
  name: "OximyHQ",
  policy: "Private by default",
  repositories: ["OximyHQ/agenttraces", "OximyHQ/collector"],
  members: [
    { name: "Naman", email: "naman@example.com", role: "Owner", device: "MacBook Pro", seen: "Now" },
    { name: "Aisha", email: "aisha@example.com", role: "Member", device: "MacBook Air", seen: "12 min ago" },
    { name: "Luis", email: "luis@example.com", role: "Member", device: "Workstation", seen: "Yesterday" },
  ],
};

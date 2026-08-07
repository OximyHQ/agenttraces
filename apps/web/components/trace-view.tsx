"use client";

import { useMemo, useRef, useState } from "react";
import type { OperationKind, TraceEvent, TraceEventKind, TraceRecord } from "@/lib/product-data";
import { ProviderLabel } from "@/components/provider-icon";
import { tabKeyIndex } from "@/lib/tabs";

const operationMeta: Record<OperationKind, { symbol: string; label: string }> = {
  file_read: { symbol: "↗", label: "File reads" },
  file_write: { symbol: "+", label: "File writes" },
  command_run: { symbol: ">_", label: "Commands" },
  repository_search: { symbol: "⌕", label: "Searches" },
  file_edit: { symbol: "±", label: "File changes" },
  web_search: { symbol: "◎", label: "Web" },
  web_fetch: { symbol: "↗", label: "Web pages" },
  mcp_call: { symbol: "◇", label: "MCP calls" },
  agent_spawn: { symbol: "↳", label: "Sub-agents" },
  agent_message: { symbol: "→", label: "Agent messages" },
  agent_complete: { symbol: "✓", label: "Agent results" },
  test_run: { symbol: "✓", label: "Tests" },
  git_status: { symbol: "≋", label: "Git status" },
  git_commit: { symbol: "●", label: "Commits" },
  git_push: { symbol: "↑", label: "Pushes" },
  generic_tool: { symbol: "◇", label: "Tools" },
};

const eventMeta: Record<TraceEventKind, { symbol: string; label: string }> = {
  user: { symbol: "", label: "User" }, assistant: { symbol: "", label: "Agent" },
  system: { symbol: "○", label: "System" }, reasoning: { symbol: "∿", label: "Reasoning" },
  tool_call: { symbol: "◇", label: "Tool call" }, tool_result: { symbol: "↵", label: "Tool result" },
  command: { symbol: ">_", label: "Command" }, file: { symbol: "±", label: "File activity" },
  usage: { symbol: "#", label: "Usage" }, metadata: { symbol: "i", label: "Metadata" },
  lifecycle: { symbol: "○", label: "Lifecycle" }, error: { symbol: "!", label: "Error" },
};

function EventRow({ event }: { event: TraceEvent }) {
  const operation = event.operation ? operationMeta[event.operation] : eventMeta[event.kind];
  if (event.kind === "user") return <article className="prompt-event" id={event.id}><div className="event-anchor"><a href={`#${event.id}`}>{event.time}</a><span>User</span></div><p>{event.content}</p></article>;
  if (event.kind === "assistant") return <article className="response-event" id={event.id}><div className="event-anchor"><a href={`#${event.id}`}>{event.time}</a><span>Agent</span></div><p>{event.content}</p></article>;
  if (event.kind === "error") return <article className="error-event" id={event.id} role="alert"><div className="event-anchor"><a href={`#${event.id}`}>{event.time}</a><span>Error</span></div><strong>{event.label ?? "Error"}</strong><p>{event.content}</p>{event.detail && <pre>{event.detail}</pre>}</article>;
  return <details className={`operation-event operation-${event.operation ?? event.kind}`} id={event.id}><summary><span className="operation-icon" aria-hidden="true">{operation.symbol}</span><strong>{event.label ?? operation.label}</strong><span className="operation-content">{event.content}</span><span className="operation-duration">{event.duration ?? event.status}</span></summary>{event.detail && <pre>{event.detail}</pre>}</details>;
}

export function TraceView({ trace, publicView = false, preview = false }: { trace: TraceRecord; publicView?: boolean; preview?: boolean }) {
  const [view, setView] = useState<"overview" | "trace">("overview");
  const [filter, setFilter] = useState<OperationKind | "all">("all");
  const [shareOpen, setShareOpen] = useState(false); const [shareState, setShareState] = useState<"idle" | "saving" | "error">("idle"); const [shareUrl, setShareUrl] = useState("");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]); const views = ["overview", "trace"] as const;
  const filtered = useMemo(() => trace.timeline.filter((event) => filter === "all" || event.operation === filter || !event.operation), [filter, trace.timeline]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(operationMeta).map((key) => [key, trace.timeline.filter((event) => event.operation === key).length])), [trace.timeline]);
  function selectView(index: number) { setView(views[index]!); tabs.current[index]?.focus(); }
  async function createShare() { setShareState("saving"); const response = await fetch(`/api/agenttraces/traces/${encodeURIComponent(trace.id)}/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "overview", audience: "anyone_with_link", agentRetrieve: true, allowContext: false, allowSkillCreation: false }) }); if (!response.ok) { setShareState("error"); return; } const result = await response.json() as { url: string }; setShareUrl(new URL(result.url, window.location.origin).toString()); setShareState("idle"); }
  return <>
    <div className="trace-topline"><div><p className="context-line"><span>{trace.repository}</span><span aria-hidden="true">·</span><ProviderLabel source={trace.source} /><span aria-hidden="true">·</span><span>{trace.updated}</span></p><h1>{trace.title}</h1></div>{!publicView && <button className="text-action" type="button" disabled={preview} title={preview ? "Sharing is disabled in the illustrative preview" : undefined} onClick={() => setShareOpen((open) => !open)}>{preview ? "Share · preview" : "Share"}</button>}</div>
    {shareOpen && !preview && <section className="share-panel" aria-label="Create trace share"><div><strong>Immutable overview</strong><p>Anyone with the link can open this point-in-time snapshot. You can revoke it later.</p></div>{shareUrl ? <div className="share-result"><code>{shareUrl}</code><button type="button" onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy link</button></div> : <button className="primary-compact" type="button" disabled={shareState === "saving"} onClick={createShare}>{shareState === "saving" ? "Creating…" : "Create link"}</button>}{shareState === "error" && <p className="form-error">The share could not be created.</p>}</section>}
    <div className="trace-tabs" role="tablist" aria-label="Trace view">
      {views.map((item, index) => <button id={`trace-tab-${item}`} aria-controls={`trace-panel-${item}`} tabIndex={view === item ? 0 : -1} ref={(node) => { tabs.current[index] = node; }} key={item} role="tab" aria-selected={view === item} onKeyDown={(event) => { const next = tabKeyIndex(index, views.length, event.key); if (next != null) { event.preventDefault(); selectView(next); } }} onClick={() => setView(item)}>{item === "overview" ? "Overview" : <>Full trace <span>{trace.events}</span></>}</button>)}
    </div>
    {view === "overview" ? <div className="overview-grid" id="trace-panel-overview" role="tabpanel" aria-labelledby="trace-tab-overview">
      <div className="overview-copy">
        <section><h2>Summary</h2><p>{trace.summary}</p></section>
        <section><h2>Work stages</h2><ol className="stage-list">{trace.stages.map((stage, index) => <li key={stage.title}><span>{index + 1}</span><div><h3>{stage.title}</h3><p>{stage.text}</p></div></li>)}</ol></section>
        <section><h2>Conversation</h2>{trace.timeline.filter((event) => event.kind === "user" || event.kind === "assistant").map((event) => <EventRow event={event} key={event.id} />)}</section>
      </div>
      <aside className="metadata-rail" aria-label="Trace metadata">
        <dl><div><dt>Owner</dt><dd>{trace.owner}</dd></div><div><dt>Repository</dt><dd>{trace.repository}</dd></div><div><dt>Branch</dt><dd><code>{trace.branch}</code></dd></div>{trace.model && <div><dt>Model</dt><dd><ProviderLabel source={trace.source} /> {trace.model}</dd></div>}<div><dt>Duration</dt><dd>{trace.duration}</dd></div><div><dt>Usage</dt><dd>{trace.tokens} tokens</dd></div><div><dt>Cost</dt><dd>{trace.cost}<small>{trace.costAccuracy}</small></dd></div></dl>
        {trace.pullRequests.length > 0 && <div className="linked-pr"><h3>Pull request</h3>{trace.pullRequests.map((pr) => <a href={`/dashboard/pull-requests/${pr.number}`} key={pr.number}>#{pr.number} {pr.title}<small>{pr.evidence}</small></a>)}</div>}
      </aside>
    </div> : <div className="full-trace-layout" id="trace-panel-trace" role="tabpanel" aria-labelledby="trace-tab-trace">
      <aside className="event-filters" aria-label="Event filters"><button data-current={filter === "all"} onClick={() => setFilter("all")}><span>All events</span><b>{trace.timeline.length}</b></button>{Object.entries(operationMeta).map(([kind, meta]) => counts[kind] ? <button data-current={filter === kind} onClick={() => setFilter(kind as OperationKind)} key={kind}><span><i>{meta.symbol}</i>{meta.label}</span><b>{counts[kind]}</b></button> : null)}</aside>
      <div className="event-stream">{filtered.map((event) => <EventRow event={event} key={event.id} />)}</div>
    </div>}
  </>;
}

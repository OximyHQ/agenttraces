import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { teamWorkspace, traces, usageSummary } from "@/lib/agenttraces-api";
import { ProviderIcon } from "@/components/provider-icon";

function compact(value: number) { return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value); }

export default async function Dashboard() {
  const [data, usage, team] = await Promise.all([traces(), usageSummary(), teamWorkspace()]);
  const records = data.records;
  const pullRequests = new Set(records.flatMap((trace) => trace.pullRequests.map((pr) => `${pr.repository ?? trace.repository}#${pr.number}`)));
  const tokenTotal = usage.inputTokens + usage.outputTokens;
  return <DashboardShell section="overview" preview={data.preview} workspaceName={team.workspace?.name ?? "Personal"} deviceCount={team.workspace?.deviceCount ?? 0}>
    <div className="page-heading"><div><p className="context-line">Workspace overview</p><h1>Recent agent work</h1></div><Link className="text-action" href="/docs/teams">Add teammates</Link></div>
    <dl className="summary-strip"><div><dt>Sessions</dt><dd>{usage.sessions}</dd><small>accessible traces</small></div><div><dt>Registered devices</dt><dd>{team.workspace?.deviceCount ?? 0}</dd><small>{team.workspace ? team.workspace.name : "personal workspace"}</small></div><div><dt>Pull requests</dt><dd>{pullRequests.size}</dd><small>with linked traces</small></div><div><dt>Reported usage</dt><dd>{compact(tokenTotal)}</dd><small>tokens · {usage.accuracy.replaceAll("_", " ")}</small></div></dl>
    <section className="dashboard-section" id="latest-traces"><div className="section-heading"><h2>Latest traces</h2>{records[0] && <Link href={`/dashboard/traces/${records[0].id}`}>View latest trace →</Link>}</div>{records.length ? <div className="trace-table" role="table" aria-label="Recent traces">{records.map((trace) => <Link className="trace-table-row" role="row" href={`/dashboard/traces/${trace.id}`} key={trace.id}><span className="source-mark" data-source={trace.source.toLowerCase().replaceAll(" ", "-")}><ProviderIcon source={trace.source} /></span><span role="cell"><strong>{trace.title}</strong><small>{trace.repository} · {trace.owner}</small></span><span role="cell">{trace.source}</span><span role="cell">{trace.updated}</span>{trace.pullRequests.length ? <b role="cell">#{trace.pullRequests[0]!.number}</b> : <b role="cell">—</b>}</Link>)}</div> : <div className="query-panel"><p>No traces yet. Start a supported coding agent after running the setup command below.</p><code>npx agenttraces up</code></div>}</section>
    <section className="dashboard-section"><div className="section-heading"><h2>Ask your traces</h2><Link href="/docs/search">Search guide →</Link></div><div className="query-panel"><code>agenttraces search &quot;what did we learn about the queue timeout?&quot;</code><p>The same search is available to Claude Code, Codex, Cursor, and any MCP-compatible agent after setup.</p></div></section>
  </DashboardShell>;
}

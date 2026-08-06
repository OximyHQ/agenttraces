/*
THESIS: AgentTraces is a quiet memory layer for coding agents, explained through evidence rather than promotion.
OWN-WORLD: White paper, small Inter type, muted links, fine rules, and compact terminal and trace surfaces.
STORY: Ask an agent to install, capture native work, retrieve permissioned evidence, and connect it to the pull request.
*/
import Link from "next/link";
import { InstallPanel } from "@/components/install-panel";
import { ProviderLabel } from "@/components/provider-icon";
import { SiteFooter, SiteHeader } from "@/components/site-header";

const sources = ["Claude Code", "Codex", "Cursor", "OpenClaw", "Conductor", "Antigravity", "GitHub Copilot"];

export default function Home() {
  return <main><a className="skip-link" href="#content">Skip to content</a><div className="page-frame"><SiteHeader /><div id="content">
    <section className="hero"><h1>Give your agent the work that came before.</h1><p className="intro">AgentTraces captures coding sessions, connects them to repositories and pull requests, and lets your current agent search the work you can access.</p><InstallPanel /><p className="quiet-note">Personal traces start private. Team owners choose the team default. AgentTraces retrieves evidence; the coding agent you already use does the reasoning.</p></section>
    <div className="section-mark" aria-hidden="true">· · ·</div>
    <section className="content-section"><h2>Ask for the work you remember</h2><p className="section-intro">You do not need the session ID or exact filename. Search in the CLI or ask through MCP.</p><div className="prompt-list"><blockquote>“Find the authentication regression we fixed last month.”</blockquote><blockquote>“What did we learn about the queue timeout?”</blockquote><blockquote>“Show every coding session behind PR #428.”</blockquote></div><p>Results are permission-filtered first, then ranked using trace text, repository context, time, and linked Git evidence. Every answer keeps its trace ID and source.</p></section>
    <div className="section-mark" aria-hidden="true">· · ·</div>
    <section className="content-section"><h2>From native session to useful record</h2><div className="flow-table"><div><span>1</span><strong>Capture</strong><p>Read local agent artifacts incrementally and scrub secrets before upload.</p></div><div><span>2</span><strong>Connect</strong><p>Preserve commits, branches, files, tool calls, and child-agent relationships.</p></div><div><span>3</span><strong>Retrieve</strong><p>Search from CLI, MCP, the dashboard, a pull request, or an immutable share.</p></div></div></section>
    <section className="content-section source-section"><h2>One record across the agents you use</h2><p className="section-intro">The collector includes parsers for all seven current sources. Product support can deepen without changing the trace model.</p><div className="source-line">{sources.map((source) => <ProviderLabel source={source} key={source} />)}</div></section>
    <section className="closing"><h2>Start with one command.</h2><p>Run the installer yourself or paste the setup prompt into your coding agent.</p><div className="closing-links"><Link href="/docs/quickstart">Read the quickstart →</Link><Link href="/dashboard">Open dashboard preview →</Link></div></section>
  </div><SiteFooter /></div></main>;
}

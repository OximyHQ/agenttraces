import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { ProviderLabel } from "@/components/provider-icon";

const sections = [
  ["Quickstart", "Install, inspect capture, and find your first earlier session.", "/docs/quickstart"],
  ["Supported agents", "See every current parser and the provider identity preserved on each trace.", "/docs/sources"],
  ["Teams", "Create setup links, register devices, and choose repository visibility.", "/docs/teams"],
  ["Search & MCP", "Ask in plain language and retrieve bounded evidence with provenance.", "/docs/search"],
  ["Traces & pull requests", "Understand linking evidence, confidence, usage, and cost accuracy.", "/docs/pull-requests"],
  ["GitHub App", "Connect installations and keep pull-request attribution current.", "/docs/github"],
  ["Sharing", "Publish immutable overviews, conversations, highlights, or full traces.", "/docs/sharing"],
  ["Self-hosting", "Run the API, worker, Postgres, Redis, object storage, and web app.", "/docs/deployment"],
] as const;

export default function Docs() { return <main><a className="skip-link" href="#content">Skip to content</a><div className="page-frame"><SiteHeader /><div id="content" className="docs-index"><p className="context-line">Documentation</p><h1>Use AgentTraces from the terminal, your agent, or the web.</h1><p className="intro">Start locally, claim the device when you are ready, and add a team only when the work belongs to one.</p><div className="docs-list">{sections.map(([title, description, href]) => <Link href={href} key={title}><strong>{title}</strong><span>{description}</span><b>→</b></Link>)}</div><section className="docs-note"><h2>Provider identity stays visible</h2><p>Every trace retains its native source and model metadata. Provider marks help scan mixed-agent work without replacing the source name.</p><div className="source-line"><ProviderLabel source="Claude Code" /><ProviderLabel source="Codex" /><ProviderLabel source="Cursor" /><ProviderLabel source="GitHub Copilot" /></div></section><section className="docs-note"><h2>What the current agent does</h2><p>AgentTraces searches and returns authorized trace evidence. Title and summary generation can run lazily through the coding-agent subscription already active in your CLI; the cached result records its provider and prompt version.</p></section></div><SiteFooter /></div></main>; }

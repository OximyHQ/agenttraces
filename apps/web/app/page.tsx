"use client";

/*
THESIS: AgentTraces is a running systems manual, not a card-based SaaS page.
OWN-WORLD: White paper, black ink, blue links, fine rules, terminal controls, and operational diagrams.
STORY: Install once, capture continuously, claim later, and retrieve prior work from any coding agent.
FIRST VIEWPORT: A direct promise, one install command, agent tabs, and the cloud-capture path in view.
FORM: A restrained technical document inspired by the supplied givemeanode reference, expanded into a system atlas and dashboard preview.
*/

import { useMemo, useState } from "react";

type InstallTarget = "personal" | "claude" | "codex" | "cursor" | "team";
type FlowKey = "capture" | "query" | "claim" | "team";

const installCommands: Record<
  InstallTarget,
  { command: string; note: string }
> = {
  personal: {
    command: "npx agenttraces up",
    note: "Detect supported agents, create a private cloud identity, and begin capturing new sessions.",
  },
  claude: {
    command: "npx agenttraces up --agent claude-code",
    note: "Install the Claude Code hook, AgentTraces skill, and MCP configuration.",
  },
  codex: {
    command: "npx agenttraces up --agent codex",
    note: "Configure Codex MCP and start incremental capture from its native session history.",
  },
  cursor: {
    command: "npx agenttraces up --agent cursor",
    note: "Register the Cursor adapter and watch its native database and session artifacts.",
  },
  team: {
    command: "npx agenttraces up --team-enrollment <token>",
    note: "Apply organization policy and route new traces into the team cloud namespace.",
  },
};

const flows: Record<
  FlowKey,
  { label: string; description: string; steps: Array<[string, string]> }
> = {
  capture: {
    label: "Capture",
    description:
      "Native session evidence becomes a replayable cloud trace without interrupting the coding agent.",
    steps: [
      ["Agent adapter", "Hooks + artifact discovery"],
      ["Local daemon", "Redact, cursor, spool"],
      ["Signed ingest", "Encrypt, retry, dedupe"],
      ["Parser worker", "Normalize with provenance"],
      ["Cloud trace", "Searchable and permissioned"],
    ],
  },
  query: {
    label: "Query",
    description:
      "The model the developer already subscribes to reasons over compact AgentTraces evidence.",
    steps: [
      ["Developer", "Asks about previous work"],
      ["Current agent", "Calls search_traces"],
      ["Cloud MCP", "Authorizes and retrieves"],
      ["Search", "Filters, ranks, cites"],
      ["Current agent", "Answers with provenance"],
    ],
  },
  claim: {
    label: "Claim",
    description:
      "Capture can start anonymously; proof of the device key attaches its existing history later.",
    steps: [
      ["Anonymous device", "Key stored locally"],
      ["Private namespace", "New traces accumulate"],
      ["GitHub login", "Single-use claim challenge"],
      ["Device proof", "Challenge is signed"],
      ["Claimed account", "Trace IDs stay stable"],
    ],
  },
  team: {
    label: "Team",
    description:
      "A scoped enrollment places traces in the organization cloud under owner-defined visibility.",
    steps: [
      ["Enrollment token", "Scoped and expiring"],
      ["Pending identity", "Device joins organization"],
      ["Org policy", "Visibility + retention"],
      ["Developer control", "Pause or tighten privacy"],
      ["Team knowledge", "Search by repo and PR"],
    ],
  },
};

const architectureLayers = [
  {
    label: "On the machine",
    purpose: "Observe without slowing the agent",
    items: [
      ["Agent adapters", "Claude Code, Codex, Cursor"],
      ["Collector", "JSONL offsets, SQLite cursors, hooks"],
      ["Local daemon", "Lifecycle, encrypted spool, retry"],
      ["CLI", "Install, status, search, privacy, doctor"],
      ["MCP stdio", "A small authenticated cloud bridge"],
    ],
  },
  {
    label: "Cloud intake",
    purpose: "Accept retries without duplicate processing",
    items: [
      ["Identity gateway", "Anonymous, claimed, or enrolled device"],
      ["Ingest API", "Signature, schema, tenant, quota"],
      ["Native store", "Compressed immutable artifacts"],
      ["Job queue", "Parsing, replay, GitHub, retention"],
      ["Parser registry", "Versioned source normalization"],
    ],
  },
  {
    label: "Knowledge core",
    purpose: "Turn evidence into permissioned retrieval",
    items: [
      ["PostgreSQL", "Traces, events, identities, grants"],
      ["Search", "Filters, full text, ranking, snippets"],
      ["Authorization", "Namespace, role, view, expiry"],
      ["GitHub linker", "Repository, commit, branch, PR"],
      ["Usage ledger", "Exact, estimated, or unavailable"],
    ],
  },
  {
    label: "Product surfaces",
    purpose: "Make the trace useful wherever work happens",
    items: [
      ["Cloud MCP", "Search, retrieve, share, create skill"],
      ["Web application", "Browse, govern, collaborate"],
      ["GitHub App", "PR and commit trace context"],
      ["Share viewer", "Revocable scoped trace access"],
      ["Operations", "Audit, retention, billing, health"],
    ],
  },
];

const surfaceGroups = [
  {
    key: "public",
    label: "Public website",
    rows: [
      ["Home", "/", "Explain the mechanism and install AgentTraces"],
      ["Sign in", "/login", "Return to a claimed personal or team account"],
      ["Docs", "/docs", "Install, use CLI/MCP, understand privacy"],
      ["Security", "/security", "Encryption, redaction, ownership, retention"],
      ["Changelog", "/changelog", "Agent support and product changes"],
      ["Status", "status.agenttraces", "Capture, ingest, search, and MCP health"],
      ["Shared trace", "/s/:token", "View only the content allowed by a share grant"],
    ],
  },
  {
    key: "activation",
    label: "Activation",
    rows: [
      ["CLI setup", "agenttraces up", "Detect agents and start cloud capture"],
      ["Claim", "/claim", "Attach anonymous device history to a user"],
      ["Team enrollment", "/enroll/:token", "Join policy-controlled team capture"],
      ["Doctor", "agenttraces doctor", "Explain and repair installation health"],
    ],
  },
  {
    key: "workspace",
    label: "Personal workspace",
    rows: [
      ["Overview", "/app", "Recent traces, active devices, capture health"],
      ["Traces", "/app/traces", "Filter and search every accessible session"],
      ["Trace detail", "/app/traces/:id", "Transcript, tools, files, Git, usage"],
      ["Search", "/app/search", "Query events, traces, PRs, and skills"],
      ["Skills", "/app/skills", "Inspect reusable knowledge and provenance"],
      ["Shares", "/app/shares", "Review links, permissions, expiry, access"],
    ],
  },
  {
    key: "team",
    label: "Team workspace",
    rows: [
      ["Team traces", "/team/:slug/traces", "Search organization-owned work"],
      ["Pull requests", "/team/:slug/pull-requests", "See sessions behind a PR"],
      ["Members", "/team/:slug/members", "Humans, pending identities, roles"],
      ["Repositories", "/team/:slug/repositories", "Mapping and exclusions"],
      ["Policies", "/team/:slug/policies", "Visibility, retention, sharing"],
      ["Usage", "/team/:slug/usage", "Agent, model, repository, PR evidence"],
    ],
  },
  {
    key: "settings",
    label: "Settings + operations",
    rows: [
      ["Devices", "/settings/devices", "Keys, versions, queue health, revoke"],
      ["Privacy", "/settings/privacy", "Defaults, exclusions, capture pause"],
      ["Integrations", "/settings/integrations", "GitHub and agent connections"],
      ["Audit", "/settings/audit", "Claims, shares, policy and access events"],
      ["Export + deletion", "/settings/data", "Portable export and retention actions"],
      ["Billing", "/settings/billing", "Plan, storage, seats, and limits"],
    ],
  },
];

const repoEntries = [
  ["apps/cli", "The `agenttraces` command surface and installation orchestrator."],
  ["apps/daemon", "Long-running capture, local spool, retries, and health."],
  ["apps/mcp", "Local stdio and remote Streamable HTTP MCP entrypoints."],
  ["apps/api", "Identity, ingest, query, team, GitHub, and sharing endpoints."],
  ["apps/worker", "Parsing, indexing, GitHub linking, replay, and retention jobs."],
  ["apps/web", "Public website, claim flow, dashboard, team, and share views."],
  ["packages/contracts", "Versioned wire schemas shared by every runtime."],
  ["packages/domain", "Identity, ownership, trace, permission, and usage rules."],
  ["packages/agent-adapters", "The narrow interface and adapter registry."],
  ["packages/adapter-*", "Native discovery, capture, hooks, setup, and diagnostics."],
  ["packages/collector", "Incremental scanning, redaction, cursoring, and batching."],
  ["packages/parsers", "Replayable source parsers and normalized trace events."],
  ["packages/search", "Authorization-aware filtering, ranking, and evidence shaping."],
  ["packages/auth", "Device keys, anonymous claim, OAuth, and enrollment."],
  ["packages/storage-*", "SQLite spool plus PostgreSQL and object-store adapters."],
  ["packages/observability", "Structured logs, metrics, diagnostics, and error contracts."],
] as const;

const deliveryPhases = [
  ["Foundation", "Contracts, fixtures, monorepo, identity decisions"],
  ["Tracer bullet", "One real trace from local artifact to cloud web view"],
  ["Continuous capture", "Daemon, recovery, backpressure, history import"],
  ["Identity + teams", "Claim, enrollment, ownership, policy"],
  ["MCP", "Retrieval plus confirmation-gated mutations"],
  ["GitHub", "Repository, commit, branch, and PR linkage"],
  ["Collaboration", "Sharing, skills, usage, export, deletion"],
  ["Beta", "Compatibility, isolation, load, privacy, operations"],
] as const;

function Dot({ state = "idle" }: { state?: "idle" | "live" | "warn" }) {
  return <span className={`dot dot-${state}`} aria-hidden="true" />;
}

export default function Home() {
  const [installTarget, setInstallTarget] =
    useState<InstallTarget>("personal");
  const [flowKey, setFlowKey] = useState<FlowKey>("capture");
  const [surfaceFilter, setSurfaceFilter] = useState("all");
  const [selectedRepo, setSelectedRepo] = useState(repoEntries[0][0]);
  const [copied, setCopied] = useState(false);

  const visibleSurfaceGroups = useMemo(
    () =>
      surfaceFilter === "all"
        ? surfaceGroups
        : surfaceGroups.filter((group) => group.key === surfaceFilter),
    [surfaceFilter],
  );

  const selectedRepoDescription =
    repoEntries.find(([path]) => path === selectedRepo)?.[1] ?? "";
  const firstRunSteps =
    installTarget === "team"
      ? ["detect agents", "validate enrollment", "apply team policy", "claim later"]
      : ["detect agents", "create identity", "capture privately", "claim later"];

  function moveTab<T extends string>(
    event: React.KeyboardEvent<HTMLButtonElement>,
    values: readonly T[],
    current: T,
    select: (value: T) => void,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = values.indexOf(current);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? values.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % values.length
            : (currentIndex - 1 + values.length) % values.length;
    select(values[nextIndex]);
    const list = event.currentTarget.parentElement;
    const buttons = list?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    buttons?.[nextIndex]?.focus();
  }

  async function copyInstallCommand() {
    await navigator.clipboard.writeText(installCommands[installTarget].command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="AgentTraces home">
          agenttraces
        </a>
        <nav aria-label="Primary navigation">
          <a href="#system">System</a>
          <a href="#surfaces">Surfaces</a>
          <a href="#repository">Repository</a>
          <a href="#dashboard">Dashboard</a>
        </nav>
      </header>

      <div id="content" className="page-shell">
        <section id="top" className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="status-line">
              <Dot state="live" /> Cloud memory for coding agents
            </p>
            <h1 id="hero-title">Give every agent the work that came before.</h1>
            <p className="hero-lede">
              AgentTraces captures coding sessions from Claude Code, Codex, and
              Cursor, turns them into permissioned cloud knowledge, and gives
              that knowledge back through CLI, MCP, GitHub, and the web.
            </p>
          </div>

          <div className="install-panel" aria-label="Installation commands">
            <div className="tab-list" role="tablist" aria-label="Install target">
              {(Object.keys(installCommands) as InstallTarget[]).map((target) => (
                <button
                  key={target}
                  className={installTarget === target ? "active" : ""}
                  onClick={() => {
                    setInstallTarget(target);
                    setCopied(false);
                  }}
                  role="tab"
                  aria-selected={installTarget === target}
                  aria-controls="install-tabpanel"
                  id={`install-tab-${target}`}
                  tabIndex={installTarget === target ? 0 : -1}
                  onKeyDown={(event) =>
                    moveTab(
                      event,
                      Object.keys(installCommands) as InstallTarget[],
                      installTarget,
                      setInstallTarget,
                    )
                  }
                  type="button"
                >
                  {target}
                </button>
              ))}
            </div>
            <div
              id="install-tabpanel"
              role="tabpanel"
              aria-labelledby={`install-tab-${installTarget}`}
            >
              <div className="command-line">
                <code>{installCommands[installTarget].command}</code>
                <button type="button" onClick={copyInstallCommand}>
                  {copied ? "copied" : "copy"}
                </button>
              </div>
              <p>{installCommands[installTarget].note}</p>
            </div>
          </div>

          <div className="first-path" aria-label="First-run path">
            {firstRunSteps.map((step, index) => (
              <span className="first-path-step" key={step}>
                <span>{step}</span>
                {index < firstRunSteps.length - 1 && (
                  <i aria-hidden="true">→</i>
                )}
              </span>
            ))}
          </div>
        </section>

        <div className="chapter-mark" aria-hidden="true">
          · · ·
        </div>

        <section id="system" className="section-block">
          <div className="section-heading">
            <h2>One system, four critical paths</h2>
            <p>
              The product is easiest to understand by following the evidence:
              onto the cloud, back into an agent, into an account, and across a
              team.
            </p>
          </div>

          <div className="flow-switcher">
            <div className="tab-list" role="tablist" aria-label="System flow">
              {(Object.keys(flows) as FlowKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={flowKey === key}
                  aria-controls="flow-tabpanel"
                  id={`flow-tab-${key}`}
                  tabIndex={flowKey === key ? 0 : -1}
                  className={flowKey === key ? "active" : ""}
                  onClick={() => setFlowKey(key)}
                  onKeyDown={(event) =>
                    moveTab(
                      event,
                      Object.keys(flows) as FlowKey[],
                      flowKey,
                      setFlowKey,
                    )
                  }
                >
                  {flows[key].label}
                </button>
              ))}
            </div>
            <div
              id="flow-tabpanel"
              role="tabpanel"
              aria-labelledby={`flow-tab-${flowKey}`}
            >
              <p className="flow-description">{flows[flowKey].description}</p>
              <div className="flow-diagram">
                {flows[flowKey].steps.map(([title, detail], index) => (
                  <div className="flow-step-wrap" key={title + detail}>
                    <div className="flow-step">
                      <span>{title}</span>
                      <small>{detail}</small>
                    </div>
                    {index < flows[flowKey].steps.length - 1 && (
                      <span className="flow-arrow" aria-hidden="true">
                        →
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section-block architecture-section">
          <div className="section-heading">
            <h2>All system components</h2>
            <p>
              Each layer has one job. Native-agent quirks remain on the machine;
              tenant ownership and retrieval remain authoritative in the cloud.
            </p>
          </div>

          <div className="architecture-map">
            {architectureLayers.map((layer, layerIndex) => (
              <div className="architecture-layer" key={layer.label}>
                <div className="layer-label">
                  <strong>{layer.label}</strong>
                  <span>{layer.purpose}</span>
                </div>
                <div className="layer-items">
                  {layer.items.map(([title, detail]) => (
                    <div className="architecture-item" key={title}>
                      <span>{title}</span>
                      <small>{detail}</small>
                    </div>
                  ))}
                </div>
                {layerIndex < architectureLayers.length - 1 && (
                  <div className="layer-connector" aria-hidden="true">
                    <span />
                    <b>durable, tenant-scoped evidence</b>
                    <span />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <div className="chapter-mark" aria-hidden="true">
          · · ·
        </div>

        <section id="surfaces" className="section-block">
          <div className="section-heading wide-heading">
            <div>
              <h2>Every product surface</h2>
              <p>
                The CLI starts the relationship. MCP makes history useful during
                work. The web makes identity, governance, and collaboration
                understandable.
              </p>
            </div>
            <label className="surface-filter">
              Show
              <select
                value={surfaceFilter}
                onChange={(event) => setSurfaceFilter(event.target.value)}
              >
                <option value="all">All surfaces</option>
                {surfaceGroups.map((group) => (
                  <option value={group.key} key={group.key}>
                    {group.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="surface-table" role="table" aria-label="Product surfaces">
            <div className="surface-row surface-header" role="row">
              <span role="columnheader">Surface</span>
              <span role="columnheader">Route / command</span>
              <span role="columnheader">Primary job</span>
            </div>
            {visibleSurfaceGroups.map((group) => (
              <div className="surface-group" key={group.key}>
                <div className="surface-group-label">{group.label}</div>
                {group.rows.map(([name, route, job]) => (
                  <div className="surface-row" role="row" key={name}>
                    <strong role="cell">{name}</strong>
                    <code role="cell">{route}</code>
                    <span role="cell">{job}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section id="dashboard" className="section-block dashboard-section">
          <div className="section-heading">
            <h2>The dashboard is an evidence browser</h2>
            <p>
              No decorative KPI wall. Start with recent work, select a trace,
              inspect its ordered evidence, and move directly to the repository
              or pull request.
            </p>
          </div>

          <div className="dashboard-demo" aria-label="Illustrative AgentTraces dashboard">
            <div className="demo-banner">
              Illustrative interface · synthetic trace data
            </div>
            <aside className="demo-nav">
              <strong>agenttraces</strong>
              <nav aria-label="Dashboard preview navigation">
                <span className="selected">Traces</span>
                <span>Search</span>
                <span>Pull requests</span>
                <span>Skills</span>
                <span>Team</span>
              </nav>
              <div className="demo-team">
                <Dot state="live" /> Acme Engineering
              </div>
            </aside>
            <div className="demo-list">
              <div className="demo-list-heading">
                <strong>Recent traces</strong>
                <span>24 this week</span>
              </div>
              <div className="demo-search">Search traces, PRs, commands…</div>
              <div className="trace-row selected">
                <span>Fix webhook replay handling</span>
                <small>payments-api · Codex · 18m</small>
                <em>PR #428</em>
              </div>
              <div className="trace-row">
                <span>Investigate queue timeout</span>
                <small>worker · Claude Code · 42m</small>
                <em>unresolved</em>
              </div>
              <div className="trace-row">
                <span>Add billing usage export</span>
                <small>dashboard · Cursor · 31m</small>
                <em>merged</em>
              </div>
              <div className="trace-row">
                <span>Trace cache invalidation</span>
                <small>api · Codex · 11m</small>
                <em>private</em>
              </div>
            </div>
            <article className="demo-detail">
              <div className="demo-detail-top">
                <div>
                  <p>payments-api / PR #428</p>
                  <h3>Fix webhook replay handling</h3>
                </div>
                <span className="visibility">team</span>
              </div>
              <dl className="trace-metadata">
                <div>
                  <dt>Agent</dt>
                  <dd>Codex</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>fix/webhook-replay</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>83</dd>
                </div>
                <div>
                  <dt>Usage</dt>
                  <dd>estimated</dd>
                </div>
              </dl>
              <div className="timeline">
                <div className="timeline-event">
                  <span className="event-time">10:42</span>
                  <div>
                    <strong>Developer</strong>
                    <p>Find why replayed events create duplicate invoices.</p>
                  </div>
                </div>
                <div className="timeline-event">
                  <span className="event-time">10:44</span>
                  <div>
                    <strong>Agent</strong>
                    <p>
                      The event ID is checked after the invoice side effect. I’m
                      tracing the transaction path before changing it.
                    </p>
                  </div>
                </div>
                <div className="timeline-event command-event">
                  <span className="event-time">10:47</span>
                  <div>
                    <strong>Command</strong>
                    <code>rg -n &quot;event_id|invoice&quot; src test</code>
                  </div>
                </div>
                <div className="timeline-event outcome-event">
                  <span className="event-time">11:00</span>
                  <div>
                    <strong>Outcome</strong>
                    <p>Unique event record now commits before invoice processing.</p>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <div className="chapter-mark" aria-hidden="true">
          · · ·
        </div>

        <section id="repository" className="section-block repository-section">
          <div className="section-heading">
            <h2>How the repository holds together</h2>
            <p>
              One TypeScript monorepo, six deployable applications, and deep
              packages at the seams where behavior genuinely varies.
            </p>
          </div>

          <div className="repo-browser">
            <div className="repo-tree" aria-label="Proposed repository">
              <div className="tree-root">agenttraces/</div>
              {repoEntries.map(([path]) => (
                <button
                  key={path}
                  type="button"
                  aria-pressed={selectedRepo === path}
                  className={selectedRepo === path ? "selected" : ""}
                  onClick={() => setSelectedRepo(path)}
                >
                  <span>{path.startsWith("apps/") ? "├─" : "└─"}</span> {path}
                </button>
              ))}
            </div>
            <div className="repo-explanation" aria-live="polite">
              <code>{selectedRepo}/</code>
              <h3>{selectedRepoDescription}</h3>
              <p>
                Callers learn one narrow interface. Source-specific formats,
                deployment details, retries, and storage behavior remain inside
                the module that owns them.
              </p>
            </div>
          </div>
        </section>

        <section className="section-block delivery-section">
          <div className="section-heading">
            <h2>Build the spine before the breadth</h2>
            <p>
              Each phase ends in an observable user outcome. No phase exists
              merely to finish an internal subsystem.
            </p>
          </div>
          <ol className="delivery-list">
            {deliveryPhases.map(([phase, outcome], index) => (
              <li key={phase}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{phase}</strong>
                <p>{outcome}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="closing-section">
          <h2>Capture once. Find it from every agent.</h2>
          <p>
            The first implementation target is one real Claude Code or Codex
            session, visible in the cloud and retrievable through MCP with its
            provenance intact.
          </p>
          <a href="#top">Start with the install flow ↑</a>
        </section>
      </div>

      <footer>
        <span>AgentTraces · system atlas</span>
        <nav aria-label="Footer navigation">
          <a href="#system">Architecture</a>
          <a href="#surfaces">Surface map</a>
          <a href="#repository">Repository</a>
        </nav>
      </footer>
    </main>
  );
}

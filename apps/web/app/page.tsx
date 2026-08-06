"use client";

/*
THESIS: AgentTraces is a quiet memory layer for coding agents, explained through evidence rather than promotion.
OWN-WORLD: White paper, small Inter type, muted links, fine rules, and compact terminal and trace surfaces.
STORY: Install locally, capture native work, retrieve permissioned evidence, and continue from any CLI or MCP client.
FIRST VIEWPORT: The promise, one real setup command, client tabs, and a precise explanation of bounded retrieval.
FORM: A narrow technical manual shaped by the measured proportions of givemeanode.com with original AgentTraces copy.
*/

import { useState } from "react";

type SetupTarget = "cli" | "claude" | "codex" | "cursor" | "mcp";

const setups: Record<
  SetupTarget,
  { label: string; command: string; description: React.ReactNode }
> = {
  cli: {
    label: "cli",
    command: "npx agenttraces up",
    description: (
      <>
        Detect supported coding agents, start private capture, and install the
        local MCP connection.
      </>
    ),
  },
  claude: {
    label: "claude",
    command: "npx agenttraces up",
    description: (
      <>
        Detect Claude Code history and add AgentTraces to its MCP configuration.
      </>
    ),
  },
  codex: {
    label: "codex",
    command: "npx agenttraces up",
    description: (
      <>
        Detect Codex sessions and add the local AgentTraces MCP server.
      </>
    ),
  },
  cursor: {
    label: "cursor",
    command: "npx agenttraces up",
    description: (
      <>
        Detect Cursor artifacts and register AgentTraces in its MCP settings.
      </>
    ),
  },
  mcp: {
    label: "mcp",
    command: "npx agenttraces mcp",
    description: (
      <>
        Run the stdio MCP server directly for any compatible client.
      </>
    ),
  },
};

const examples = [
  {
    title: "Remember the fix, not the filename",
    prompt: "Find the authentication regression we fixed last month.",
    answer:
      "AgentTraces searches the work you can access, then returns compact evidence with the repository, source, time, and trace ID intact.",
  },
  {
    title: "Continue an investigation",
    prompt: "What did we learn about the queue timeout?",
    answer:
      "Your current agent can retrieve the earlier commands, decisions, and outcome instead of repeating the investigation from scratch.",
  },
  {
    title: "Recover the work behind a change",
    prompt: "Show me the trace behind PR #428.",
    answer:
      "Git and pull-request evidence narrow the search. The result stays linked to the native session it came from.",
  },
] as const;

const sources = [
  ["Claude Code", "JSONL session history"],
  ["Codex", "Native rollout history"],
  ["Cursor", "Local session databases"],
  ["OpenClaw", "Session artifacts"],
  ["Conductor", "Agent workspaces"],
  ["Antigravity", "Agent session files"],
  ["GitHub Copilot", "Local conversation data"],
] as const;

const traceEvents = [
  ["10:42", "Question", "Find why replayed events create duplicate invoices."],
  ["10:44", "Reasoning", "The event ID is checked after the invoice side effect."],
  ["10:47", "Command", 'rg -n "event_id|invoice" src test'],
  ["11:00", "Outcome", "Commit the unique event record before invoice processing."],
] as const;

export default function Home() {
  const [target, setTarget] = useState<SetupTarget>("cli");
  const [copied, setCopied] = useState(false);
  const targetKeys = Object.keys(setups) as SetupTarget[];

  function chooseTarget(next: SetupTarget) {
    setTarget(next);
    setCopied(false);
  }

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = targetKeys.indexOf(target);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? targetKeys.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % targetKeys.length
            : (index - 1 + targetKeys.length) % targetKeys.length;
    chooseTarget(targetKeys[nextIndex]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("[role='tab']")
      [nextIndex]?.focus();
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(setups[target].command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <main>
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <div className="page-frame">
        <header className="site-header">
          <a className="wordmark" href="#top" aria-label="AgentTraces home">
            agenttraces
          </a>
          <nav aria-label="Primary navigation">
            <a href="https://github.com/OximyHQ/agenttraces/tree/master/docs">
              Docs
            </a>
            <a href="https://github.com/OximyHQ/agenttraces">GitHub</a>
            <a href="#install">Install</a>
          </nav>
        </header>

        <div id="content">
          <section className="hero" id="top" aria-labelledby="hero-title">
            <h1 id="hero-title">Give your agent the work that came before.</h1>
            <p className="intro">
              AgentTraces captures coding-agent sessions and makes them
              searchable from the CLI or any MCP client. Your current agent does
              the reasoning; AgentTraces retrieves the evidence.
            </p>

            <div className="install-panel" id="install">
              <div className="setup-tabs" role="tablist" aria-label="Setup target">
                {targetKeys.map((key) => (
                  <button
                    type="button"
                    role="tab"
                    id={`setup-${key}`}
                    aria-controls="setup-panel"
                    aria-selected={target === key}
                    tabIndex={target === key ? 0 : -1}
                    className={target === key ? "active" : ""}
                    onClick={() => chooseTarget(key)}
                    onKeyDown={moveTab}
                    key={key}
                  >
                    {setups[key].label}
                  </button>
                ))}
              </div>
              <div
                className="setup-panel"
                id="setup-panel"
                role="tabpanel"
                aria-labelledby={`setup-${target}`}
              >
                <div className="command-row">
                  <code>{setups[target].command}</code>
                  <button type="button" onClick={copyCommand} aria-live="polite">
                    {copied ? "copied" : "copy"}
                  </button>
                </div>
                <p>{setups[target].description}</p>
              </div>
            </div>

            <blockquote className="product-note">
              Search returns a small set of authorized traces—not a dump of every
              event. Each result keeps its provenance so an agent can retrieve
              only the evidence it needs.
            </blockquote>
          </section>

          <div className="section-mark" aria-hidden="true">
            · · ·
          </div>

          <section className="content-section" id="search">
            <h2>Find past work in one sentence</h2>
            <p className="section-intro">
              Search the way you remember the work. AgentTraces filters first by
              what you are allowed to see, then ranks matching traces and
              evidence.
            </p>

            <div className="example-list">
              {examples.map((example) => (
                <article className="example" key={example.title}>
                  <h3>{example.title}</h3>
                  <blockquote>{example.prompt}</blockquote>
                  <p>{example.answer}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="section-mark" aria-hidden="true">
            · · ·
          </div>

          <section className="content-section" id="trace">
            <h2>A trace is evidence, not another chat transcript</h2>
            <p className="section-intro">
              A result opens into the smallest useful view of the work: who did
              it, where it happened, what changed, and the native events behind
              the answer.
            </p>

            <figure className="trace-preview">
              <figcaption>Illustrative interface · synthetic trace data</figcaption>
              <div className="trace-heading">
                <div>
                  <p>payments-api / PR #428</p>
                  <h3>Fix webhook replay handling</h3>
                </div>
                <span>team</span>
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
                  <dt>Trace</dt>
                  <dd>tr_01J8…42E</dd>
                </div>
              </dl>
              <div className="trace-events">
                {traceEvents.map(([time, kind, text]) => (
                  <div className="trace-event" key={`${time}-${kind}`}>
                    <time>{time}</time>
                    <strong>{kind}</strong>
                    {kind === "Command" ? <code>{text}</code> : <p>{text}</p>}
                  </div>
                ))}
              </div>
            </figure>
          </section>

          <section className="content-section path-section" id="capture">
            <h2>Capture once, retrieve wherever you work</h2>
            <div className="path-grid">
              <div>
                <h3>On your machine</h3>
                <ol>
                  <li><span>1</span> Discover native session artifacts</li>
                  <li><span>2</span> Scrub secrets before enqueue</li>
                  <li><span>3</span> Encrypt the pending local spool</li>
                </ol>
              </div>
              <div>
                <h3>In the cloud</h3>
                <ol>
                  <li><span>4</span> Normalize events with provenance</li>
                  <li><span>5</span> Apply namespace permissions</li>
                  <li><span>6</span> Retrieve through CLI or MCP</li>
                </ol>
              </div>
            </div>
            <p className="path-note">
              Personal traces are private by default. In a team, the owner
              defines the default visibility and retention policy.
            </p>
          </section>

          <div className="section-mark" aria-hidden="true">
            · · ·
          </div>

          <section className="content-section" id="sources">
            <h2>Seven local collectors, one trace model</h2>
            <p className="section-intro">
              Local adapters understand all seven native formats. Claude Code
              and Codex lead the first end-to-end path; the remaining rows show
              collector coverage, not a promise of full product support.
            </p>
            <div className="source-table" role="table" aria-label="Supported sources">
              {sources.map(([source, artifact]) => (
                <div className="source-row" role="row" key={source}>
                  <strong role="cell">{source}</strong>
                  <span role="cell">{artifact}</span>
                  <span role="cell" className="source-status">collector ready</span>
                </div>
              ))}
            </div>
          </section>

          <section className="closing">
            <h2>Make earlier work available to the next agent.</h2>
            <p>
              Install AgentTraces, keep new sessions private, and ask your
              current agent for the work you remember.
            </p>
            <div className="closing-command">
              <code>npx agenttraces up</code>
              <a href="https://www.npmjs.com/package/agenttraces">View on npm</a>
            </div>
          </section>
        </div>

        <footer>
          <span>AgentTraces</span>
          <nav aria-label="Footer navigation">
            <a href="https://github.com/OximyHQ/agenttraces">GitHub</a>
            <a href="https://www.npmjs.com/package/agenttraces">npm</a>
            <a href="#top">Top ↑</a>
          </nav>
        </footer>
      </div>
    </main>
  );
}
